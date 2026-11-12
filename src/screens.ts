export const SCREEN_STORAGE_KEY = 'esper-magician:screen'

export const screens = [
  {
    id: '2.8',
    title: '2.8-inch screen',
    caption: 'ESP32-2432S028R · 320 × 240',
    bezelCaption: 'Your screen (320 × 240)',
    orientation: 'landscape',
    width: 320,
    height: 240,
  },
  {
    id: '1.9',
    title: '1.9-inch screen',
    caption: 'Estardyn · 170 × 320',
    bezelCaption: 'Your screen (170 × 320)',
    orientation: 'portrait',
    width: 170,
    height: 320,
  },
] as const

export type Screen = (typeof screens)[number]
export type ScreenId = Screen['id']

const screenById: Record<ScreenId, Screen> = {
  '2.8': screens[0],
  '1.9': screens[1],
}

export function screenFor(id: ScreenId): Screen {
  return screenById[id]
}

export function parseStoredScreen(value: unknown): ScreenId {
  if (value === '1.9' || value === '2.8') return value
  return '2.8'
}

export function readStoredScreenId(): ScreenId {
  try {
    return parseStoredScreen(localStorage.getItem(SCREEN_STORAGE_KEY))
  } catch {
    return '2.8'
  }
}

export function storeScreenId(id: ScreenId): boolean {
  try {
    localStorage.setItem(SCREEN_STORAGE_KEY, id)
    return true
  } catch {
    return false
  }
}
