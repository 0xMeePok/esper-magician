/**
 * A text design from the Text page: what the person made, kept so it can be opened and changed
 * again. It turns into a scene (sceneFormat.ts) only when it is sent to the screen.
 */
import { FONTS, type FontId } from './fonts.ts'

/**
 * How the design sits on the screen. 0 is upright (170 × 320). 90 is sideways, the screen turned
 * a quarter to the left so its pins are on the right; 270 the other way; 180 upside down.
 */
export type Orientation = 0 | 90 | 180 | 270

export type TextEffect = 'plain' | 'neon' | 'led'
export type ScrollDirection = 'none' | 'left' | 'right' | 'up' | 'down'
export type BlinkSpeed = 'off' | 'slow' | 'fast'
export type Align = 'left' | 'center' | 'right'
/** Scrolling text: the next pass starts once this one has gone, or right behind it. */
export type Spacing = 'apart' | 'close'
export type PictureFit = 'cover' | 'contain' | 'stretch'

/** A rectangle on the design, in its own pixels (the screen's, turned to the orientation). */
export type Box = { x: number; y: number; width: number; height: number }

export type TextLayer = Box & {
  id: string
  kind: 'text'
  text: string
  font: FontId
  /** Letter height in pixels. */
  size: number
  color: string
  effect: TextEffect
  /** LED dot spacing in pixels. */
  dot: number
  align: Align
  /** Degrees clockwise. Scrolling text turns in quarter turns only. */
  rotation: number
  scroll: ScrollDirection
  /** Pixels per second. */
  speed: number
  spacing: Spacing
  blink: BlinkSpeed
}

export type PictureLayer = Box & {
  id: string
  kind: 'picture'
  mediaId: string
  fit: PictureFit
  rotation: number
  blink: BlinkSpeed
}

export type Layer = TextLayer | PictureLayer

/** A picture added to a design, kept with it. */
export type DesignMedia = { id: string; name: string; type: string; blob: Blob; animated: boolean }

export type Design = {
  id: string
  name: string
  orientation: Orientation
  background: string
  /** The screen's backlight while it shows, in percent. */
  brightness: number
  /** Back to front. */
  layers: Layer[]
  media: DesignMedia[]
  createdAt: number
  updatedAt: number
}

export const MAX_LAYERS = 12
export const MIN_BOX = 8
export const SPEEDS = { min: 10, max: 240 } as const
export const SIZES = { min: 8, max: 240 } as const
export const DOTS = { min: 3, max: 10 } as const
export const BRIGHTNESS = { min: 10, max: 100 } as const

/** Milliseconds shown, then hidden. */
export const BLINK_MS: Record<BlinkSpeed, readonly [number, number]> = {
  off: [0, 0],
  slow: [800, 400],
  fast: [250, 250],
}

export function designSize(orientation: Orientation, screen: { width: number; height: number }) {
  return orientation === 90 || orientation === 270
    ? { width: screen.height, height: screen.width }
    : { width: screen.width, height: screen.height }
}

export function isQuarterTurn(degrees: number): boolean {
  return ((degrees % 90) + 90) % 90 === 0
}

/** The layer's turn: scrolling text keeps to quarter turns so the screen can move it exactly. */
export function layerRotation(layer: Layer): number {
  if (layer.kind === 'text' && layer.scroll !== 'none' && !isQuarterTurn(layer.rotation)) {
    return Math.round(layer.rotation / 90) * 90
  }
  return layer.rotation
}

/** Whether a layer changes on the screen by itself. */
export function isMoving(layer: Layer): boolean {
  return layer.kind === 'text' && layer.scroll !== 'none'
}

export function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function newTextLayer(size: { width: number; height: number }, overrides: Partial<TextLayer> = {}): TextLayer {
  const height = Math.min(size.height, 90)
  return {
    id: makeId(),
    kind: 'text',
    text: 'HELLO',
    font: 'block',
    size: Math.round(height * 0.6),
    color: '#ff3b6b',
    effect: 'plain',
    dot: 4,
    align: 'center',
    rotation: 0,
    scroll: 'none',
    speed: 60,
    spacing: 'apart',
    blink: 'off',
    x: 0,
    y: Math.round((size.height - height) / 2),
    width: size.width,
    height,
    ...overrides,
  }
}

/** A first design: an LED scroller across the screen held sideways. */
export function newDesign(screen: { width: number; height: number }, now = Date.now()): Design {
  const orientation: Orientation = 90
  const size = designSize(orientation, screen)
  return {
    id: makeId(),
    name: 'My sign',
    orientation,
    background: '#000000',
    brightness: 100,
    layers: [
      // Edge to edge: an LED panel fills the whole screen.
      newTextLayer(size, {
        text: 'WELCOME',
        font: 'pixel',
        effect: 'led',
        color: '#ff9f1a',
        size: 64,
        dot: 4,
        scroll: 'left',
        speed: 60,
        y: 0,
        height: size.height,
      }),
    ],
    media: [],
    createdAt: now,
    updatedAt: now,
  }
}

const ORIENTATIONS: readonly Orientation[] = [0, 90, 180, 270]
const EFFECTS: readonly TextEffect[] = ['plain', 'neon', 'led']
const SCROLLS: readonly ScrollDirection[] = ['none', 'left', 'right', 'up', 'down']
const BLINKS: readonly BlinkSpeed[] = ['off', 'slow', 'fast']
const ALIGNS: readonly Align[] = ['left', 'center', 'right']
const SPACINGS: readonly Spacing[] = ['apart', 'close']
const FITS: readonly PictureFit[] = ['cover', 'contain', 'stretch']

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function num(value: unknown, fallback: number, min = -10000, max = 10000): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

function parseBox(value: Record<string, unknown>): Box {
  return {
    x: Math.round(num(value.x, 0)),
    y: Math.round(num(value.y, 0)),
    width: Math.round(num(value.width, 100, MIN_BOX, 4000)),
    height: Math.round(num(value.height, 40, MIN_BOX, 4000)),
  }
}

function parseLayer(value: unknown, mediaIds: Set<string>): Layer | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const id = str(raw.id, '') || makeId()
  if (raw.kind === 'text') {
    return {
      id,
      kind: 'text',
      ...parseBox(raw),
      text: str(raw.text, ''),
      font: pick(raw.font, FONTS.map((font) => font.id), 'sans'),
      size: Math.round(num(raw.size, 40, SIZES.min, SIZES.max)),
      color: color(raw.color, '#ffffff'),
      effect: pick(raw.effect, EFFECTS, 'plain'),
      dot: Math.round(num(raw.dot, 4, DOTS.min, DOTS.max)),
      align: pick(raw.align, ALIGNS, 'center'),
      rotation: num(raw.rotation, 0, -360, 360),
      scroll: pick(raw.scroll, SCROLLS, 'none'),
      speed: Math.round(num(raw.speed, 60, SPEEDS.min, SPEEDS.max)),
      spacing: pick(raw.spacing, SPACINGS, 'apart'),
      blink: pick(raw.blink, BLINKS, 'off'),
    }
  }
  if (raw.kind === 'picture' && typeof raw.mediaId === 'string' && mediaIds.has(raw.mediaId)) {
    return {
      id,
      kind: 'picture',
      ...parseBox(raw),
      mediaId: raw.mediaId,
      fit: pick(raw.fit, FITS, 'cover'),
      rotation: num(raw.rotation, 0, -360, 360),
      blink: pick(raw.blink, BLINKS, 'off'),
    }
  }
  return null
}

function parseMedia(value: unknown): DesignMedia | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !(raw.blob instanceof Blob)) return null
  return {
    id: raw.id,
    name: str(raw.name, 'Picture'),
    type: str(raw.type, raw.blob.type),
    blob: raw.blob,
    animated: raw.animated === true,
  }
}

/** Reads a stored design back, dropping anything it doesn't recognise. Null if it isn't one. */
export function parseDesign(value: unknown): Design | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const media = Array.isArray(raw.media) ? raw.media.flatMap((item) => parseMedia(item) ?? []) : []
  const mediaIds = new Set(media.map((item) => item.id))
  const layers = Array.isArray(raw.layers) ? raw.layers.flatMap((layer) => parseLayer(layer, mediaIds) ?? []) : []
  return {
    id: raw.id,
    name: str(raw.name, 'Untitled'),
    orientation: pick(raw.orientation, ORIENTATIONS, 0),
    background: color(raw.background, '#000000'),
    brightness: Math.round(num(raw.brightness, 100, BRIGHTNESS.min, BRIGHTNESS.max)),
    layers: layers.slice(0, MAX_LAYERS),
    media: media.filter((item) => layers.some((layer) => layer.kind === 'picture' && layer.mediaId === item.id)),
    createdAt: num(raw.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: num(raw.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  }
}

/**
 * Keeps a design playable: at most one moving picture (a GIF), and it sits at the back, since
 * the screen draws everything else over it. Other GIFs show their first frame.
 */
export function animatedPictureId(design: Design): string | null {
  const first = design.layers[0]
  if (first?.kind !== 'picture') return null
  const media = design.media.find((item) => item.id === first.mediaId)
  return media?.animated ? first.id : null
}
