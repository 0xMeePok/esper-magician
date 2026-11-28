import { applyPalette, GIFEncoder, quantize, type Encoder, type Palette } from 'gifenc'
import { decompressFrame, parseGIF, type ParsedGif } from 'gifuct-js'
import type { ScreenCrop, Size } from '../crop.ts'
import { flatten, transformFrame, type Frame } from './frames.ts'
import type { Strength } from './strengths.ts'

export type EncodedResult = { strength: Strength['id']; bytes: Uint8Array; width: number; height: number; frames: number }

type Progress = (done: number) => void

/** Browsers play GIF delays under 20 ms at 100 ms; keep that so playback speed doesn't change. */
export function playbackDelay(delay: number): number {
  return delay < 20 ? 100 : delay
}

type GifFrame = Extract<ParsedGif['frames'][number], { image: unknown }>

function isImageFrame(frame: ParsedGif['frames'][number]): frame is GifFrame {
  return 'image' in frame
}

/**
 * Decodes every frame in order, applying GIF disposal so each yielded frame is the full picture
 * a browser would show, already flattened onto the screen's background (or, with `flat` false,
 * with its see-through pixels kept).
 */
export function* gifFrames(
  bytes: ArrayBuffer,
  { flat = true }: { flat?: boolean } = {},
): Generator<{ frame: Frame; delay: number; index: number; count: number }> {
  const gif = parseGIF(bytes)
  const frames = gif.frames.filter(isImageFrame)
  const width = gif.lsd.width
  const height = gif.lsd.height
  const canvas = new Uint8ClampedArray(width * height * 4)
  let previous: { left: number; top: number; width: number; height: number; disposal: number } | null = null
  let restore: Uint8ClampedArray | null = null

  for (let index = 0; index < frames.length; index++) {
    if (previous?.disposal === 2) {
      for (let y = previous.top; y < previous.top + previous.height && y < height; y++) {
        canvas.fill(0, (y * width + previous.left) * 4, (y * width + Math.min(previous.left + previous.width, width)) * 4)
      }
    } else if (previous?.disposal === 3 && restore) {
      canvas.set(restore)
    }

    const parsed = decompressFrame(frames[index]!, gif.gct, true)
    const { left, top, width: w, height: h } = parsed.dims
    restore = parsed.disposalType === 3 ? canvas.slice() : null
    const patch = parsed.patch
    for (let y = 0; y < h; y++) {
      const cy = top + y
      if (cy >= height) break
      for (let x = 0; x < w; x++) {
        const cx = left + x
        if (cx >= width) break
        const from = (y * w + x) * 4
        if (patch[from + 3] === 0) continue
        const to = (cy * width + cx) * 4
        canvas[to] = patch[from]!
        canvas[to + 1] = patch[from + 1]!
        canvas[to + 2] = patch[from + 2]!
        canvas[to + 3] = 255
      }
    }
    previous = { left, top, width: w, height: h, disposal: parsed.disposalType }
    yield {
      frame: flat ? flatten({ data: canvas, width, height }) : { data: canvas.slice(), width, height },
      delay: playbackDelay(parsed.delay),
      index,
      count: frames.length,
    }
  }
}

type Rect = { left: number; top: number; width: number; height: number }

type Pending = {
  index: Uint8Array
  palette: Palette
  delay: number
  colorDepth: number
  rect: Rect
  /** Palette slot for "leave the pixel as it is", or -1 on a frame that covers everything. */
  transparentIndex: number
}

/**
 * Unchanged pixels shorter than this between two changed ones are drawn anyway: the player draws
 * each run of changed pixels separately, and many tiny runs cost more time than a few repeats.
 */
const MIN_GAP = 12

/** Same colour within `tolerance` (summed over red, green and blue). */
function same(a: Uint8ClampedArray, b: Uint8ClampedArray, at: number, tolerance: number) {
  return Math.abs(a[at]! - b[at]!) + Math.abs(a[at + 1]! - b[at + 1]!) + Math.abs(a[at + 2]! - b[at + 2]!) <= tolerance
}

function depthFor(colors: number) {
  return Math.max(2, Math.ceil(Math.log2(Math.max(colors, 2))))
}

class StrengthEncoder {
  readonly encoder: Encoder = GIFEncoder()
  pending: Pending | null = null
  written = 0
  width = 0
  height = 0
  readonly strength: Strength
  /**
   * For each pixel, the source colour it had when it was last drawn. A later frame only redraws
   * pixels that moved away from this, so small differences can't pile up frame after frame.
   */
  drawn: Uint8ClampedArray | null = null

  constructor(strength: Strength) {
    this.strength = strength
  }

  add(frame: Frame, delay: number, frameIndex: number) {
    if (frameIndex % this.strength.gifFrameStep !== 0) {
      // Dropped frame: its time goes to the frame still on screen.
      if (this.pending) this.pending.delay += delay
      return
    }
    if (!this.drawn || frame.width !== this.width || frame.height !== this.height) {
      this.addWhole(frame, delay)
      return
    }
    const changed = this.changedPixels(frame)
    if (!changed) {
      // Nothing visible changed: keep the frame on screen longer instead.
      if (this.pending) this.pending.delay += delay
      return
    }
    this.addChanges(frame, delay, changed.mask, changed.rect)
  }

  /** The first frame: every pixel, no transparency. */
  private addWhole(frame: Frame, delay: number) {
    this.flush()
    const palette = quantize(frame.data, this.strength.gifColors)
    this.width = frame.width
    this.height = frame.height
    this.drawn = frame.data.slice()
    this.pending = {
      index: applyPalette(frame.data, palette),
      palette,
      delay,
      colorDepth: depthFor(palette.length),
      rect: { left: 0, top: 0, width: frame.width, height: frame.height },
      transparentIndex: -1,
    }
  }

  /** Which pixels to draw (1) or leave (0), and the smallest rectangle around them. */
  private changedPixels(frame: Frame): { mask: Uint8Array; rect: Rect } | null {
    const { width, height } = frame
    const drawn = this.drawn!
    const tolerance = this.strength.gifTolerance
    const mask = new Uint8Array(width * height)
    let left = width
    let right = -1
    let top = height
    let bottom = -1
    for (let y = 0; y < height; y++) {
      let lastChanged = -1
      for (let x = 0; x < width; x++) {
        const at = y * width + x
        if (same(frame.data, drawn, at * 4, tolerance)) continue
        // Fill a short gap back to the previous changed pixel in this row.
        if (lastChanged >= 0 && x - lastChanged - 1 < MIN_GAP) mask.fill(1, y * width + lastChanged + 1, at)
        mask[at] = 1
        lastChanged = x
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
    if (right < 0) return null
    return { mask, rect: { left, top, width: right - left + 1, height: bottom - top + 1 } }
  }

  /** A later frame: only the rectangle around the changes, with unchanged pixels transparent. */
  private addChanges(frame: Frame, delay: number, mask: Uint8Array, rect: Rect) {
    this.flush()
    const drawn = this.drawn!
    const region = new Uint8ClampedArray(rect.width * rect.height * 4)
    const opaque = new Uint8ClampedArray(rect.width * rect.height * 4)
    let opaqueCount = 0
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const at = (rect.top + y) * frame.width + rect.left + x
        const from = at * 4
        const to = (y * rect.width + x) * 4
        region.set(frame.data.subarray(from, from + 4), to)
        if (mask[at]) {
          opaque.set(frame.data.subarray(from, from + 4), opaqueCount * 4)
          opaqueCount++
          drawn.set(frame.data.subarray(from, from + 4), from)
        }
      }
    }
    // One palette slot is kept for "transparent", the pixels this frame leaves alone.
    const palette = quantize(opaque.subarray(0, opaqueCount * 4), this.strength.gifColors - 1)
    const index = applyPalette(region, palette)
    const transparentIndex = palette.length
    palette.push([0, 0, 0])
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        if (!mask[(rect.top + y) * frame.width + rect.left + x]) index[y * rect.width + x] = transparentIndex
      }
    }
    this.pending = { index, palette, delay, colorDepth: depthFor(palette.length), rect, transparentIndex }
  }

  flush() {
    if (!this.pending) return
    const { index, palette, delay, colorDepth, rect, transparentIndex } = this.pending
    const start = this.encoder.bytesView().length
    const transparent = transparentIndex >= 0
    this.encoder.writeFrame(index, rect.width, rect.height, {
      palette,
      delay,
      repeat: 0,
      colorDepth,
      transparent,
      transparentIndex: transparent ? transparentIndex : 0,
      dispose: 1, // keep this frame on screen; the next one draws over it
    })
    if (rect.left || rect.top) placeFrame(this.encoder.bytesView(), start, rect)
    this.written++
    this.pending = null
  }

  finish(): EncodedResult {
    this.flush()
    this.encoder.finish()
    return {
      strength: this.strength.id,
      bytes: this.encoder.bytes(),
      width: this.width,
      height: this.height,
      frames: this.written,
    }
  }
}

/**
 * gifenc always writes a frame at (0, 0). Moves the frame just written to the rectangle's corner
 * by editing its image descriptor, which follows the 8-byte graphic control extension.
 */
function placeFrame(bytes: Uint8Array, start: number, rect: Rect) {
  const at = start + 8
  if (bytes[start] !== 0x21 || bytes[start + 1] !== 0xf9 || bytes[at] !== 0x2c) {
    throw new Error('Unexpected GIF layout from gifenc.')
  }
  bytes[at + 1] = rect.left & 0xff
  bytes[at + 2] = rect.left >> 8
  bytes[at + 3] = rect.top & 0xff
  bytes[at + 4] = rect.top >> 8
}

/**
 * Encodes frames that are already the screen's size at every strength, lightest first, the way
 * compressGif does (a text design's moving background).
 */
export function encodeGifFrames(frames: Iterable<{ frame: Frame; delay: number }>, strengths: readonly Strength[]): EncodedResult[] {
  const encoders = strengths.map((strength) => new StrengthEncoder(strength))
  let index = 0
  for (const { frame, delay } of frames) {
    for (const encoder of encoders) encoder.add(frame, delay, index)
    index++
  }
  if (index === 0) throw new Error('No frames to encode.')
  return encoders.map((encoder) => encoder.finish())
}

/**
 * ASH-31: re-encodes a GIF at every strength in one pass over its frames, so the frames are
 * never all held in memory. Frames are scaled to the screen (crop applied if given).
 */
export function compressGif(
  bytes: ArrayBuffer,
  strengths: readonly Strength[],
  screen: Size,
  crop: ScreenCrop | null,
  onProgress?: Progress,
): EncodedResult[] {
  const encoders = strengths.map((strength) => new StrengthEncoder(strength))
  let decoded = 0
  for (const { frame, delay, index, count } of gifFrames(bytes)) {
    const scaled = transformFrame(frame, screen, crop)
    for (const encoder of encoders) encoder.add(scaled, delay, index)
    decoded++
    onProgress?.(decoded / count)
  }
  if (decoded === 0) throw new Error('This GIF has no frames.')
  return encoders.map((encoder) => encoder.finish())
}
