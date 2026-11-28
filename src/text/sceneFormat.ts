/**
 * A text design as the screen plays it (media kind 3, a "scene"): a background and up to 32
 * sprites, pictures with see-through edges that the player moves and blinks itself. Keep in step
 * with firmware/main/scene_format.h; the motion and drawing here are the player's, line for line,
 * so the editor's preview moves exactly like the screen.
 *
 * The payload, little-endian:
 *   0x00  "SCNE"
 *   0x04  u16 version (1)
 *   0x06  u16 sprite count
 *   0x08  u16 background: 0 colour, 1 RGB565 picture, 2 GIF
 *   0x0A  u16 background colour (RGB565)
 *   0x0C  u32 picture/GIF offset, 0x10 u32 its length
 *   0x14  u8 backlight brightness in percent (0 = full), then 3 reserved bytes
 *   0x18  32 bytes per sprite: i16 clip x, y, w, h; i16 x, y; u16 w, h; i16 dx, dy; u16 step_ms;
 *         u16 period; u16 blink on, off (ms); u32 pixels offset (u16 RGB565, u8 alpha each)
 */

export const SCENE_HEADER_BYTES = 24
export const SCENE_SPRITE_BYTES = 32
export const SCENE_MAX_SPRITES = 32
export const SCENE_VERSION = 1

export type SceneRect = { x: number; y: number; w: number; h: number }

/** Where a sprite is and how it moves; the pixels are kept apart (a canvas in the editor). */
export type SpriteMotion = {
  /** It only shows inside this rectangle. */
  clip: SceneRect
  /** Top-left corner at the start. */
  x: number
  y: number
  w: number
  h: number
  /** Pixels moved per step, along one axis. */
  dx: number
  dy: number
  stepMs: number
  /** Distance between copies along the move; 0 for one copy. */
  period: number
  /** Shown for blinkOnMs, hidden for blinkOffMs; 0 and 0 for always shown. */
  blinkOnMs: number
  blinkOffMs: number
}

export type SceneSprite = SpriteMotion & {
  /** w*h pixels: RGB565 little-endian, then alpha. */
  pixels: Uint8Array
}

export type SceneBackground =
  | { kind: 'color'; color: number }
  /** width*height RGB565 pixels, row by row. */
  | { kind: 'picture'; color: number; pixels: Uint16Array }
  | { kind: 'gif'; color: number; bytes: Uint8Array }

export type Scene = {
  background: SceneBackground
  sprites: SceneSprite[]
  /** The screen's backlight while it shows, 1..100 percent. */
  brightness?: number
}

const BG_CODE = { color: 0, picture: 1, gif: 2 } as const

/** Packs 8-bit RGB into RGB565, as the player and its GIF decoder do. */
export function rgb565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}

/** "#rrggbb" as RGB565. */
export function hex565(hex: string): number {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16) || 0
  return rgb565((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
}

/** RGB565 back to 8-bit RGB, for showing it. */
export function rgbOf565(value: number): [number, number, number] {
  const r = (value >> 11) & 0x1f
  const g = (value >> 5) & 0x3f
  const b = value & 0x1f
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

function backgroundBytes(background: SceneBackground): number {
  if (background.kind === 'picture') return background.pixels.length * 2
  if (background.kind === 'gif') return background.bytes.length
  return 0
}

/** How many bytes the packed scene takes. */
export function sceneBytes(background: SceneBackground, sprites: readonly { w: number; h: number }[]): number {
  const pictures = sprites.reduce((sum, sprite) => sum + sprite.w * sprite.h * 3, 0)
  return SCENE_HEADER_BYTES + sprites.length * SCENE_SPRITE_BYTES + backgroundBytes(background) + pictures
}

export function packScene(scene: Scene): Uint8Array {
  const { background, sprites } = scene
  if (sprites.length > SCENE_MAX_SPRITES) throw new Error(`At most ${SCENE_MAX_SPRITES} parts fit in one design.`)
  const out = new Uint8Array(sceneBytes(background, sprites))
  const view = new DataView(out.buffer)
  out.set([0x53, 0x43, 0x4e, 0x45], 0) // "SCNE"
  view.setUint16(4, SCENE_VERSION, true)
  view.setUint16(6, sprites.length, true)
  view.setUint16(8, BG_CODE[background.kind], true)
  view.setUint16(10, background.color, true)
  out[0x14] = Math.max(1, Math.min(100, Math.round(scene.brightness ?? 100)))
  let at = SCENE_HEADER_BYTES + sprites.length * SCENE_SPRITE_BYTES
  if (background.kind !== 'color') {
    const bytes =
      background.kind === 'picture'
        ? new Uint8Array(background.pixels.buffer, background.pixels.byteOffset, background.pixels.byteLength)
        : background.bytes
    view.setUint32(12, at, true)
    view.setUint32(16, bytes.length, true)
    if (background.kind === 'picture') {
      for (let i = 0; i < background.pixels.length; i++) view.setUint16(at + i * 2, background.pixels[i]!, true)
    } else {
      out.set(bytes, at)
    }
    at += bytes.length
  }
  sprites.forEach((sprite, index) => {
    if (sprite.pixels.length !== sprite.w * sprite.h * 3) throw new Error('Sprite pixels and size disagree.')
    const p = SCENE_HEADER_BYTES + index * SCENE_SPRITE_BYTES
    const fields = [sprite.clip.x, sprite.clip.y, sprite.clip.w, sprite.clip.h, sprite.x, sprite.y]
    fields.forEach((value, i) => view.setInt16(p + i * 2, value, true))
    view.setUint16(p + 12, sprite.w, true)
    view.setUint16(p + 14, sprite.h, true)
    view.setInt16(p + 16, sprite.dx, true)
    view.setInt16(p + 18, sprite.dy, true)
    view.setUint16(p + 20, sprite.stepMs, true)
    view.setUint16(p + 22, sprite.period, true)
    view.setUint16(p + 24, sprite.blinkOnMs, true)
    view.setUint16(p + 26, sprite.blinkOffMs, true)
    view.setUint32(p + 28, at, true)
    out.set(sprite.pixels, at)
    at += sprite.pixels.length
  })
  return out
}

function moving(s: SpriteMotion): boolean {
  return (s.dx !== 0 || s.dy !== 0) && s.stepMs > 0
}

function blinking(s: SpriteMotion): boolean {
  return s.blinkOnMs > 0 && s.blinkOffMs > 0
}

function stepsAt(s: SpriteMotion, t: number): number {
  return moving(s) ? Math.floor(t / s.stepMs) : 0
}

/** Where the first copy is at `t` ms (scene_sprite_at). */
export function spriteAt(s: SpriteMotion, t: number): { x: number; y: number } {
  if (!moving(s)) return { x: s.x, y: s.y }
  const distance = stepsAt(s, t) * Math.abs(s.dx || s.dy)
  const off = s.period ? distance % s.period : Math.min(distance, 30000)
  if (s.dx) return { x: s.x + (s.dx > 0 ? off : -off), y: s.y }
  return { x: s.x, y: s.y + (s.dy > 0 ? off : -off) }
}

export function spriteVisible(s: SpriteMotion, t: number): boolean {
  if (!blinking(s)) return true
  return t % (s.blinkOnMs + s.blinkOffMs) < s.blinkOnMs
}

/** When something next moves or blinks after `t`, or Infinity (scene_next_change). */
export function nextChange(sprites: readonly SpriteMotion[], t: number): number {
  let next = Infinity
  for (const s of sprites) {
    if (moving(s)) next = Math.min(next, (Math.floor(t / s.stepMs) + 1) * s.stepMs)
    if (blinking(s)) {
      const cycle = s.blinkOnMs + s.blinkOffMs
      const phase = t % cycle
      next = Math.min(next, t - phase + (phase < s.blinkOnMs ? s.blinkOnMs : cycle))
    }
  }
  return next
}

/** The copies that reach into the clip: the first one's corner, their spacing, how many. */
export function spriteCopies(s: SpriteMotion, t: number): { x: number; y: number; stepX: number; stepY: number; count: number } {
  const at = spriteAt(s, t)
  if (!moving(s) || !s.period) return { ...at, stepX: 0, stepY: 0, count: 1 }
  const p = s.period
  if (s.dx) {
    const x = at.x + (Math.floor((s.clip.x - s.w - at.x) / p) + 1) * p
    const end = s.clip.x + s.clip.w
    return { x, y: at.y, stepX: p, stepY: 0, count: x < end ? Math.ceil((end - x) / p) : 0 }
  }
  const y = at.y + (Math.floor((s.clip.y - s.h - at.y) / p) + 1) * p
  const end = s.clip.y + s.clip.h
  return { x: at.x, y, stepX: 0, stepY: p, count: y < end ? Math.ceil((end - y) / p) : 0 }
}

/** The part of the screen a sprite covers at `t` (scene_sprite_area). */
export function spriteArea(s: SpriteMotion, t: number): SceneRect {
  const none = { x: 0, y: 0, w: 0, h: 0 }
  if (!spriteVisible(s, t) || s.clip.w <= 0 || s.clip.h <= 0) return none
  const c = spriteCopies(s, t)
  if (c.count <= 0) return none
  const x0 = Math.max(c.x, s.clip.x)
  const y0 = Math.max(c.y, s.clip.y)
  const x1 = Math.min(c.x + c.stepX * (c.count - 1) + s.w, s.clip.x + s.clip.w)
  const y1 = Math.min(c.y + c.stepY * (c.count - 1) + s.h, s.clip.y + s.clip.h)
  return x1 <= x0 || y1 <= y0 ? none : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The clip kept on the screen, as the player does when it reads the scene. */
export function clampClip(clip: SceneRect, width: number, height: number): SceneRect {
  const x0 = Math.max(clip.x, 0)
  const y0 = Math.max(clip.y, 0)
  const x1 = Math.min(clip.x + Math.max(clip.w, 0), width)
  const y1 = Math.min(clip.y + Math.max(clip.h, 0), height)
  return { x: x0, y: y0, w: Math.max(x1 - x0, 0), h: Math.max(y1 - y0, 0) }
}

/** Mixes `fg` over `bg` like the player: 33 steps of see-through, 0..32 (scene_blend). */
export function blend565(bg: number, fg: number, alpha: number): number {
  const a = (alpha * 33) >> 8
  const b = (bg | (bg << 16)) & 0x07e0f81f
  const f = (fg | (fg << 16)) & 0x07e0f81f
  const mix = Math.floor((f * a + b * (32 - a)) / 32) & 0x07e0f81f
  return (mix | (mix >>> 16)) & 0xffff
}

/**
 * The whole screen at `t` ms, as the player draws it (a GIF background shows as its colour
 * here). For the tests: the editor draws with a canvas instead.
 */
export function composeFrame(scene: Scene, t: number, width: number, height: number): Uint16Array {
  const out = new Uint16Array(width * height)
  const bg = scene.background
  if (bg.kind === 'picture') out.set(bg.pixels)
  else out.fill(bg.color)
  for (const raw of scene.sprites) {
    const s = { ...raw, clip: clampClip(raw.clip, width, height) }
    if (!spriteVisible(s, t)) continue
    const c = spriteCopies(s, t)
    for (let k = 0; k < c.count; k++) {
      const cx = c.x + k * c.stepX
      const cy = c.y + k * c.stepY
      const x0 = Math.max(cx, s.clip.x)
      const y0 = Math.max(cy, s.clip.y)
      const x1 = Math.min(cx + s.w, s.clip.x + s.clip.w)
      const y1 = Math.min(cy + s.h, s.clip.y + s.clip.h)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = ((y - cy) * s.w + (x - cx)) * 3
          const alpha = s.pixels[at + 2]!
          if (alpha === 0) continue
          const color = s.pixels[at]! | (s.pixels[at + 1]! << 8)
          out[y * width + x] = alpha === 255 ? color : blend565(out[y * width + x]!, color, alpha)
        }
      }
    }
  }
  return out
}
