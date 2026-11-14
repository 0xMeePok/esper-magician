export const VIEWPORT_WIDTH = 320
export const VIEWPORT_HEIGHT = 240
export const BEZEL_FRAME = 16
export const BEZEL_RADIUS = 12
export const BEZEL_WIDTH = VIEWPORT_WIDTH + BEZEL_FRAME * 2

export const VIEWPORT_LABEL = 'Screen preview'
export const SCREEN_CAPTION = 'Your screen (320 \u00d7 240)'
export const EMPTY_MESSAGE = 'Nothing on the screen yet.'
export const EMPTY_HELPER = 'Pick an example or upload a picture.'
export const LOADING_MESSAGE = 'Loading\u2026'
export const OPENING_MESSAGE = 'Opening your file\u2026'

export const ERROR_UNSUPPORTED_TYPE =
  'This file type isn\u2019t supported. Use a JPEG, PNG, WebP, or GIF.'
export const ERROR_UNREADABLE_FILE =
  'This file couldn\u2019t be opened. Try a different picture or animation.'
export const ERROR_EXAMPLE_FAILED =
  'This example couldn\u2019t be shown. Try another one or upload a picture.'

export const viewportColors = {
  emptyFill: '#2A2A2A',
  bezel: '#1A1A1A',
  helper: '#4A4A4A',
  errorBg: '#FFF1F2',
  errorText: '#9F1239',
  inViewportText: '#EEEEEE',
  focus: '#0F766E',
} as const

export const emptyViewportState = { status: 'empty' } as const

export type ViewportErrorInterior = 'empty' | 'plain'

export type ViewportState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'opening' }
  | { status: 'error'; message: string; interior: ViewportErrorInterior }
  | { status: 'content'; src: string; animated?: boolean }

export type ViewportAnnouncement =
  | { kind: 'helper'; text: string }
  | { kind: 'progress'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'none' }

export function viewportAnnouncement(state: ViewportState): ViewportAnnouncement {
  switch (state.status) {
    case 'empty':
      return { kind: 'helper', text: EMPTY_HELPER }
    case 'loading':
      return { kind: 'progress', text: LOADING_MESSAGE }
    case 'opening':
      return { kind: 'progress', text: OPENING_MESSAGE }
    case 'error':
      return { kind: 'error', text: state.message }
    case 'content':
      return { kind: 'none' }
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

export function isGifSrc(src: string): boolean {
  const trimmed = src.trim()
  if (/^data:image\/gif(?:;|,)/i.test(trimmed)) return true
  const path = trimmed.split(/[?#]/, 1)[0] ?? ''
  return path.toLowerCase().endsWith('.gif')
}

export function contentShowsStillFrame(
  src: string,
  animated: boolean | undefined,
  reducedMotion: boolean,
): boolean {
  if (!reducedMotion) return false
  return animated === true || isGifSrc(src)
}

export type CoverRect = {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export function coverDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth = VIEWPORT_WIDTH,
  boxHeight = VIEWPORT_HEIGHT,
): CoverRect {
  const dest = { dx: 0, dy: 0, dw: boxWidth, dh: boxHeight }
  if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return {
      sx: 0,
      sy: 0,
      sw: Math.max(sourceWidth, 0),
      sh: Math.max(sourceHeight, 0),
      ...dest,
    }
  }

  const sourceAspect = sourceWidth / sourceHeight
  const boxAspect = boxWidth / boxHeight
  if (sourceAspect > boxAspect) {
    const sh = sourceHeight
    const sw = sourceHeight * boxAspect
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh, ...dest }
  }

  const sw = sourceWidth
  const sh = sourceWidth / boxAspect
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw, sh, ...dest }
}
