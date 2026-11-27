import type { Size } from '../crop.ts'
import type { KnownDevice } from './deviceStore.ts'

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

type ScreenInfo = { firmware?: string; version?: string; screen?: Size }

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
function reach(popup: Window, url: string, timeoutMs: number): Promise<{ origin: string; screen?: Size } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs)
    const listen = (event: MessageEvent) => {
      const message = fromScreen(event, popup)
      if (message?.type === 'ready') finish({ origin: event.origin, screen: message.screen })
    }
    function finish(result: { origin: string; screen?: Size } | null) {
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
  let reached: { origin: string; screen?: Size } | null = null
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
