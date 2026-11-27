/** The screen this browser has set up, so later updates can go over Wi-Fi. */
export type KnownDevice = {
  /** Where the screen answered on the Wi-Fi, e.g. "http://192.168.1.23/". */
  url: string
  /** The same screen by name, e.g. "http://esper-a1b2c3.local/", tried if the address changed. */
  localUrl: string | null
  savedAt: number
}

export const DEVICE_STORAGE_KEY = 'esper-magician:device'

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'http:'
  } catch {
    return false
  }
}

export function parseKnownDevice(value: unknown): KnownDevice | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isHttpUrl(record.url)) return null
  return {
    url: record.url,
    localUrl: isHttpUrl(record.localUrl) ? record.localUrl : null,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
  }
}

/** Builds a device from the addresses the screen reports over Improv. */
export function deviceFromUrls(urls: string[], now = Date.now()): KnownDevice | null {
  const usable = urls.filter(isHttpUrl)
  if (!usable.length) return null
  return {
    url: usable[0]!,
    localUrl: usable.find((url) => url.includes('.local')) ?? null,
    savedAt: now,
  }
}

export function readKnownDevice(): KnownDevice | null {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY)
    return raw ? parseKnownDevice(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveKnownDevice(device: KnownDevice | null) {
  try {
    if (device) localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device))
    else localStorage.removeItem(DEVICE_STORAGE_KEY)
  } catch {
    // Private mode or storage off: the next update just uses USB again.
  }
}

/**
 * The setup page on the screen links here as ?screen=http://192.168.1.23/. Remembers that screen
 * for Wi-Fi sends and takes the parameter out of the address bar.
 */
export function adoptScreenFromAddress(location: Location = window.location, now = Date.now()): KnownDevice | null {
  const url = new URL(location.href)
  const value = url.searchParams.get('screen')
  if (value === null) return null
  url.searchParams.delete('screen')
  try {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // Some test environments have no history; the parameter just stays.
  }
  if (!isHttpUrl(value)) return null
  const device = deviceFromUrls([`${new URL(value).origin}/`], now)
  if (device) saveKnownDevice(device)
  return device
}
