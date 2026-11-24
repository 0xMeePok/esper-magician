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
 * a browser would show, already flattened onto the screen's background.
 */
export function* gifFrames(bytes: ArrayBuffer): Generator<{ frame: Frame; delay: number; index: number; count: number }> {
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
      frame: flatten({ data: canvas, width, height }),
      delay: playbackDelay(parsed.delay),
      index,
      count: frames.length,
    }
  }
}

type Pending = { index: Uint8Array; palette: Palette; delay: number; colorDepth: number }

class StrengthEncoder {
  readonly encoder: Encoder = GIFEncoder()
  pending: Pending | null = null
  written = 0
  width = 0
  height = 0
  readonly strength: Strength

  constructor(strength: Strength) {
    this.strength = strength
  }

  add(frame: Frame, delay: number, frameIndex: number) {
    if (frameIndex % this.strength.gifFrameStep !== 0) {
      // Dropped frame: its time goes to the frame still on screen.
      if (this.pending) this.pending.delay += delay
      return
    }
    this.flush()
    const palette = quantize(frame.data, this.strength.gifColors)
    const index = applyPalette(frame.data, palette)
    const colorDepth = Math.max(2, Math.ceil(Math.log2(Math.max(palette.length, 2))))
    this.width = frame.width
    this.height = frame.height
    this.pending = { index, palette, delay, colorDepth }
  }

  flush() {
    if (!this.pending) return
    const { index, palette, delay, colorDepth } = this.pending
    this.encoder.writeFrame(index, this.width, this.height, { palette, delay, repeat: 0, colorDepth })
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
