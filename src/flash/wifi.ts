import type { Size } from '../crop.ts'
import type { KnownDevice } from './deviceStore.ts'
import { readMediaHeader, SCENE_PLAYER_VERSION } from './mediaImage.ts'

/**
 * Sending a picture over Wi-Fi.
 *
 * The site is on https and the screen serves plain http on the home network, which browsers
 * normally block. Chrome and Edge allow it for a request marked as going to the local network
 * (Local Network Access, with a one-time permission prompt), so `sendInPage` calls the screen
 * straight from this page; the screen answers CORS for the site (firmware/main/web.c).
 *
 * Where the browser won't, `sendOverWifi` opens the screen's own page
 * (firmware/main/receiver.html) in a small window and hands it the picture with postMessage; that
 * page posts it to the screen. Keep the messages in step with receiver.html.
 */

export type WifiProblem = 'blocked' | 'unreachable' | 'other-screen' | 'failed'

export class WifiError extends Error {
  readonly problem: WifiProblem
  constructor(problem: WifiProblem, detail?: string) {
    super(detail ?? problem)
    this.problem = problem
  }
}

/** Chrome's Local Network Access: lets this https page call the screen's http address. */
const LOCAL_NETWORK = { targetAddressSpace: 'local' } as RequestInit

type ScreenInfo = { firmware?: string; version?: string; hostname?: string; screen?: Size }

async function askInfo(base: string, timeoutMs: number): Promise<ScreenInfo | null> {
  try {
    const response = await fetch(`${base}info`, {
      ...LOCAL_NETWORK,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok ? ((await response.json()) as ScreenInfo) : null
  } catch {
    return null
  }
}

/** "1.5.0" before "1.6.0". */
export function olderVersion(version: string, than: string): boolean {
  const a = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = than.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  }
  return false
}

/**
 * A text design needs a player that knows them; an older one would only show its test card.
 * Updating the player takes a USB send.
 */
function checkPlayer(image: Uint8Array, version: string | undefined) {
  if (readMediaHeader(image)?.kind !== 'scene' || !version || !olderVersion(version, SCENE_PLAYER_VERSION)) return
  throw new WifiError(
    'failed',
    `Your screen's player (${version}) is too old for text designs. Send this design over USB once to update it; Wi-Fi works again after that.`,
  )
}

export type LogChunk = { text: string; start: number; next: number }

/**
 * Reads the screen's log written since `since` (a running byte count), over Wi-Fi from this page
 * (GET /log, firmware/main/logbuf.c, firmware 1.4.0 and newer). `start` is where the text really
 * begins: later than `since` when older lines have been overwritten.
 */
export async function readLog(device: KnownDevice, since: number, timeoutMs = 8000): Promise<LogChunk> {
  const urls = [device.url, device.localUrl].filter((url): url is string => Boolean(url))
  for (const base of urls) {
    try {
      const response = await fetch(`${base}log?since=${since}`, {
        ...LOCAL_NETWORK,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
      const start = Number(response.headers.get('X-Log-Start'))
      const next = Number(response.headers.get('X-Log-Next'))
      if (!response.ok || !response.headers.has('X-Log-Next') || !Number.isFinite(start) || !Number.isFinite(next)) {
        continue
      }
      return { text: await response.text(), start, next }
    } catch {
      // Blocked, not there, or older firmware: try the next address.
    }
  }
  throw new WifiError('unreachable')
}

/**
 * Turns what someone types into the screen's address: its hotspot name ("ESPER-49F5C0", which is
 * also its name on the Wi-Fi), "esper-49f5c0.local", an IP address, or a full http address.
 */
export function screenAddress(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const code = text.match(/^esper-([0-9a-f]{6})(?:\.local)?\/?$/i)
  if (code) return `http://esper-${code[1]!.toLowerCase()}.local/`
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  try {
    const url = new URL(withScheme)
    // The screen only speaks plain http on the home network.
    if (url.protocol !== 'http:' || !url.hostname) return null
    return `${url.origin}/`
  } catch {
    return null
  }
}

/** Checks, from this page, that there is a screen like this one at `url`. */
export async function findScreen(
  url: string,
  screen: Size,
  timeoutMs = 20000,
): Promise<{ url: string; localUrl: string | null }> {
  const info = await askInfo(url, timeoutMs)
  if (!info) throw new WifiError('unreachable')
  if (info.screen && (info.screen.width !== screen.width || info.screen.height !== screen.height)) {
    throw new WifiError('other-screen')
  }
  return { url, localUrl: info.hostname ? `http://${info.hostname}.local/` : null }
}

/**
 * Sends the picture straight from this page. Throws `unreachable` when no address answers, which
 * is also what a browser without Local Network Access (or a declined prompt) looks like, so the
 * caller offers the small window then. There is no upload progress: fetch can't report it here.
 */
export async function sendInPage(
  device: KnownDevice,
  image: Uint8Array,
  screen: Size,
  // The first call can wait on Chrome's "devices on your local network" prompt.
  timeoutMs = 20000,
): Promise<void> {
  const urls = [device.url, device.localUrl].filter((url): url is string => Boolean(url))
  let base: string | null = null
  let info: ScreenInfo | null = null
  for (const url of urls) {
    info = await askInfo(url, timeoutMs)
    if (info) {
      base = url
      break
    }
  }
  if (!base || !info) throw new WifiError('unreachable')
  if (info.screen && (info.screen.width !== screen.width || info.screen.height !== screen.height)) {
    throw new WifiError('other-screen')
  }
  checkPlayer(image, info.version)

  let reply: { ok?: boolean; message?: string } = {}
  try {
    const response = await fetch(`${base}media`, {
      ...LOCAL_NETWORK,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: image.slice().buffer,
      cache: 'no-store',
    })
    reply = await response.json().catch(() => ({}))
    if (response.ok && reply.ok) return
  } catch {
    throw new WifiError('failed', "The picture didn't reach your screen. Check it's still on the Wi-Fi, then try again.")
  }
  throw new WifiError('failed', reply.message)
}

type FromScreen =
  | { source: 'esper'; type: 'ready'; screen?: Size; firmware?: string; version?: string }
  | { source: 'esper'; type: 'progress'; sent: number; total: number }
  | { source: 'esper'; type: 'done' }
  | { source: 'esper'; type: 'error'; message?: string }

const WINDOW_NAME = 'esper-screen'
const WINDOW_FEATURES = 'popup,width=420,height=320'

/** Opens the helper window. Call straight from a click, or the browser blocks it. */
export function openScreenWindow(): Window {
  const popup = window.open('about:blank', WINDOW_NAME, WINDOW_FEATURES)
  if (!popup) throw new WifiError('blocked')
  try {
    popup.document.title = 'ESPER screen'
    popup.document.body.style.font = '16px system-ui, sans-serif'
    popup.document.body.textContent = 'Getting your picture ready…'
  } catch {
    // Already showing another page; it gets replaced next.
  }
  return popup
}

function fromScreen(event: MessageEvent, popup: Window): FromScreen | null {
  if (event.source !== popup) return null
  const data = event.data as Partial<FromScreen> | null
  return data && data.source === 'esper' ? (data as FromScreen) : null
}

/** Points the window at one address and waits for the screen's page to say hello. */
type Reached = { origin: string; screen?: Size; version?: string }

function reach(popup: Window, url: string, timeoutMs: number): Promise<Reached | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs)
    const listen = (event: MessageEvent) => {
      const message = fromScreen(event, popup)
      if (message?.type === 'ready') finish({ origin: event.origin, screen: message.screen, version: message.version })
    }
    function finish(result: Reached | null) {
      clearTimeout(timer)
      window.removeEventListener('message', listen)
      resolve(result)
    }
    window.addEventListener('message', listen)
    popup.location.href = url
  })
}

export async function sendOverWifi(
  popup: Window,
  device: KnownDevice,
  image: Uint8Array,
  screen: Size,
  onProgress: (fraction: number) => void,
  timeoutMs = 8000,
): Promise<void> {
  if (popup.closed) throw new WifiError('blocked')
  const urls = [device.url, device.localUrl].filter((url): url is string => Boolean(url))
  let reached: Reached | null = null
  for (const url of urls) {
    reached = await reach(popup, url, timeoutMs)
    if (reached || popup.closed) break
  }
  if (!reached) {
    if (!popup.closed) popup.close()
    throw new WifiError('unreachable')
  }
  if (reached.screen && (reached.screen.width !== screen.width || reached.screen.height !== screen.height)) {
    popup.close()
    throw new WifiError('other-screen')
  }
  try {
    checkPlayer(image, reached.version)
  } catch (error) {
    popup.close()
    throw error
  }

  const origin = reached.origin
  await new Promise<void>((resolve, reject) => {
    const watch = setInterval(() => {
      if (popup.closed) finish(new WifiError('failed', 'The window was closed.'))
    }, 500)
    const listen = (event: MessageEvent) => {
      const message = fromScreen(event, popup)
      if (!message) return
      if (message.type === 'progress' && message.total) onProgress(message.sent / message.total)
      else if (message.type === 'done') finish()
      else if (message.type === 'error') finish(new WifiError('failed', message.message))
    }
    function finish(error?: Error) {
      clearInterval(watch)
      window.removeEventListener('message', listen)
      if (error) reject(error)
      else resolve()
    }
    window.addEventListener('message', listen)
    const buffer = image.slice().buffer
    popup.postMessage({ source: 'esper-site', type: 'send', image: buffer }, origin, [buffer])
  })
  onProgress(1)
}
