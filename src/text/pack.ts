/**
 * Turns a laid-out design (render.ts) into the bytes the screen plays (sceneFormat.ts): each
 * sprite trimmed to its visible pixels, the background as exact pixels or a GIF.
 */
import { encodeGifFrames, type EncodedResult } from '../compress/gif.ts'
import { STRENGTHS } from '../compress/strengths.ts'
import { context, drawBackground, type BuiltScene, type BuiltSprite } from './render.ts'
import { packScene, rgb565, sceneBytes, type SceneBackground, type SceneSprite } from './sceneFormat.ts'

export class DesignTooBigError extends Error {
  constructor() {
    super("This design won't fit on the screen. Make scrolling text shorter or smaller, or use fewer or smaller pictures.")
  }
}

type Trim = { x0: number; y0: number; x1: number; y1: number }

/** The rows and columns holding anything visible. Null when nothing is. */
function visibleArea(rgba: Uint8ClampedArray, width: number, height: number): Trim | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/**
 * A sprite's pixels as the screen stores them, trimmed of see-through edges. A moving sprite
 * keeps its length along the move, so its repeats stay evenly spaced.
 */
export function spritePixels(sprite: BuiltSprite): SceneSprite | null {
  const { width, height } = sprite.canvas
  const rgba = context(sprite.canvas).getImageData(0, 0, width, height).data
  const seen = visibleArea(rgba, width, height)
  if (!seen) return null
  const trim = {
    x0: sprite.dx ? 0 : seen.x0,
    x1: sprite.dx ? width : seen.x1,
    y0: sprite.dy ? 0 : seen.y0,
    y1: sprite.dy ? height : seen.y1,
  }
  const w = trim.x1 - trim.x0
  const h = trim.y1 - trim.y0
  const pixels = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((y + trim.y0) * width + x + trim.x0) * 4
      const to = (y * w + x) * 3
      const alpha = rgba[from + 3]!
      if (alpha === 0) continue
      const color = rgb565(rgba[from]!, rgba[from + 1]!, rgba[from + 2]!)
      pixels[to] = color & 0xff
      pixels[to + 1] = color >> 8
      pixels[to + 2] = alpha
    }
  }
  const { canvas: _canvas, layerId: _layerId, ...motion } = sprite
  return { ...motion, x: sprite.x + trim.x0, y: sprite.y + trim.y0, w, h, pixels }
}

function picturePixels(built: BuiltScene, gifIndex = 0): { rgba: Uint8ClampedArray; pixels: Uint16Array } {
  const { width, height } = built.device
  const rgba = context(drawBackground(built, gifIndex)).getImageData(0, 0, width, height).data
  const pixels = new Uint16Array(width * height)
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgb565(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)
  return { rgba, pixels }
}

/** The moving background as a GIF at every strength, lightest first. */
function backgroundGif(built: BuiltScene): EncodedResult[] {
  const frames = built.gif!.part.gif!.source.frames
  const { width, height } = built.device
  return encodeGifFrames(
    frames.map(({ delay }, index) => ({ frame: { data: picturePixels(built, index).rgba, width, height }, delay })),
    STRENGTHS,
  )
}

/** Roughly how many bytes the design takes on the screen, before trimming (a moving picture not counted). */
export function estimateBytes(built: BuiltScene): number {
  const background = built.gif || built.baked.length === 0 ? 0 : built.device.width * built.device.height * 2
  return sceneBytes({ kind: 'color', color: 0 }, built.sprites) + background
}

/** The design's bytes for the screen. Throws DesignTooBigError when it can't fit in `budget`. */
export function packDesign(
  built: BuiltScene,
  budget = Infinity,
): { payload: Uint8Array; sprites: SceneSprite[]; background: SceneBackground } {
  const sprites = built.sprites.flatMap((sprite) => spritePixels(sprite) ?? [])
  const color = built.color565
  let background: SceneBackground = { kind: 'color', color }
  if (built.gif) {
    const room = budget - sceneBytes({ kind: 'color', color }, sprites)
    const fits = backgroundGif(built).find((result) => result.bytes.length <= room)
    if (!fits) throw new DesignTooBigError()
    background = { kind: 'gif', color, bytes: fits.bytes }
  } else if (built.baked.length > 0) {
    background = { kind: 'picture', color, pixels: picturePixels(built).pixels }
  }
  if (sceneBytes(background, sprites) > budget) throw new DesignTooBigError()
  return { payload: packScene({ background, sprites, brightness: built.brightness }), sprites, background }
}
