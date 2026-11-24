import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import encodeJpeg, { init as initJpeg } from '@jsquash/jpeg/encode.js'
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { decompressFrames, parseGIF } from 'gifuct-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { initialCrop, type ScreenCrop } from '../crop.ts'
import { FLASH_LAYOUTS, formatBytes, MEDIA_HEADER_BYTES, mediaBudget, partition } from '../flashLayout.ts'
import { screenFor } from '../screens.ts'
import { BACKGROUND, cropKey, flatten, targetSize, transformFrame, type Frame } from './frames.ts'
import { compressGif, gifFrames, playbackDelay } from './gif.ts'
import { compressStill, DEVICE_JPEG_OPTIONS } from './still.ts'
import { STRENGTHS } from './strengths.ts'

const wide = screenFor('2.8')
const tall = screenFor('1.9')

/** Quadrants: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
function quadrants(width: number, height: number, alpha = 255): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const right = x >= width / 2
      const bottom = y >= height / 2
      const color = !bottom ? (right ? [0, 200, 0] : [220, 0, 0]) : right ? [240, 220, 0] : [0, 0, 230]
      data.set([...color, alpha], at)
    }
  }
  return { data, width, height }
}

function pixel(frame: Frame, x: number, y: number) {
  const at = (y * frame.width + x) * 4
  return [...frame.data.slice(at, at + 3)]
}

function near(a: number[], b: readonly number[], tolerance = 12) {
  return a.every((value, index) => Math.abs(value - b[index]!) <= tolerance)
}

/** A real GIF made with gifenc: `frames` frames of a moving bar, 40 ms each. */
function makeGif(width: number, height: number, frames: number, delay = 40): ArrayBuffer {
  const gif = GIFEncoder()
  for (let i = 0; i < frames; i++) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lit = Math.floor((x / width) * frames) === i
        const noise = (x * 31 + y * 17 + i * 7) % 64
        data.set(lit ? [250, 120, 30, 255] : [20 + noise, 40, 120 + noise, 255], (y * width + x) * 4)
      }
    }
    const palette = quantize(data, 256)
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay })
  }
  gif.finish()
  const bytes = gif.bytes()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function readGif(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const parsed = parseGIF(buffer)
  return { parsed, frames: decompressFrames(parsed, true) }
}

describe('flash layout (ASH-33)', () => {
  it('tiles 4 MB exactly with a 640 KB factory app and 64 KB-aligned apps', () => {
    const layout = FLASH_LAYOUTS['2.8']
    const parts = layout.partitions
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]!.offset).toBe(parts[i - 1]!.offset + parts[i - 1]!.size)
    }
    expect(parts.at(-1)!.offset + parts.at(-1)!.size).toBe(layout.flashBytes)
    expect(partition(layout, 'factory')).toMatchObject({ offset: 0x10000, size: 640 * 1024 })
    for (const app of parts.filter((part) => part.type === 'app')) expect(app.offset % 0x10000).toBe(0)
    expect(partition(layout, 'otadata').size).toBe(0x2000)
  })

  it('matches the partition table the firmware ships', () => {
    const csv = readFileSync(join(process.cwd(), 'firmware', 'partitions.csv'), 'utf8')
    const rows = csv
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => line.split(',').map((cell) => cell.trim()))
    expect(rows.map(([name, type, subtype, offset, size]) => ({
      name,
      type,
      subtype,
      offset: Number(offset),
      size: Number(size),
    }))).toEqual(FLASH_LAYOUTS['2.8'].partitions)
  })

  it('leaves 1,896,448 bytes for one picture on each screen and formats sizes plainly', () => {
    expect(MEDIA_HEADER_BYTES).toBe(4096)
    expect(mediaBudget('2.8')).toBe(1_896_448)
    expect(mediaBudget('1.9')).toBe(1_896_448)
    expect(formatBytes(1_896_448)).toBe('1.81 MB')
    expect(formatBytes(4_214_393)).toBe('4.02 MB')
    expect(formatBytes(640 * 1024)).toBe('640 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatBytes(12 * 1024 * 1024 + 300_000)).toBe('12.3 MB')
    expect(formatBytes(900)).toBe('900 bytes')
  })
})

describe('frame transform', () => {
  it('fits the whole picture inside the screen and never enlarges it', () => {
    expect(targetSize({ width: 1600, height: 900 }, wide, null)).toEqual({ width: 320, height: 180 })
    expect(targetSize({ width: 1600, height: 900 }, tall, null)).toEqual({ width: 170, height: 96 })
    expect(targetSize({ width: 600, height: 1000 }, wide, null)).toEqual({ width: 144, height: 240 })
    expect(targetSize({ width: 100, height: 50 }, wide, null)).toEqual({ width: 100, height: 50 })
  })

  it('scales down and keeps each quadrant where it was', () => {
    const out = transformFrame(quadrants(1600, 900), wide, null)
    expect([out.width, out.height]).toEqual([320, 180])
    expect(near(pixel(out, 40, 40), [220, 0, 0])).toBe(true)
    expect(near(pixel(out, 280, 40), [0, 200, 0])).toBe(true)
    expect(near(pixel(out, 40, 140), [0, 0, 230])).toBe(true)
    expect(near(pixel(out, 280, 140), [240, 220, 0])).toBe(true)
  })

  it('applies a saved crop and rotation so the result fills the screen', () => {
    const source = quadrants(1600, 900)
    const turned: ScreenCrop = {
      rotationDeg: 90,
      cropRect: { x: 0, y: 0, width: 900, height: 675 },
    }
    const out = transformFrame(source, wide, turned)
    expect([out.width, out.height]).toEqual([320, 240])
    // Turned right, the top-left of the view is the old bottom-left (blue), top-right is red.
    expect(near(pixel(out, 20, 20), [0, 0, 230])).toBe(true)
    expect(near(pixel(out, 300, 20), [220, 0, 0])).toBe(true)

    const portrait = transformFrame(source, tall, initialCrop({ width: 1600, height: 900 }, tall))
    expect([portrait.width, portrait.height]).toEqual([170, 320])
  })

  it('flattens transparency onto the screen background', () => {
    const out = flatten(quadrants(4, 4, 0))
    expect(pixel(out, 0, 0)).toEqual([...BACKGROUND])
    expect(cropKey(null)).toBe('none')
    expect(cropKey({ rotationDeg: 90, cropRect: { x: 1.234, y: 2, width: 3, height: 4 } })).toBe('90:1.23:2:3:4')
  })
})

describe('GIF compression (ASH-31)', () => {
  it('decodes every frame with its delay', () => {
    const frames = [...gifFrames(makeGif(40, 30, 5, 60))]
    expect(frames).toHaveLength(5)
    expect(frames.map((entry) => entry.delay)).toEqual([60, 60, 60, 60, 60])
    expect(frames[0]!.frame.width).toBe(40)
    expect(playbackDelay(0)).toBe(100)
    expect(playbackDelay(10)).toBe(100)
  })

  it('makes three looping GIFs at screen size that keep the original speed', () => {
    const source = makeGif(480, 360, 12, 50)
    const progress: number[] = []
    const results = compressGif(source, STRENGTHS, wide, null, (done) => progress.push(done))
    expect(results.map((result) => result.strength)).toEqual(['light', 'balanced', 'strong'])
    expect(progress.at(-1)).toBe(1)

    const [light, balanced, strong] = results.map((result) => ({ result, ...readGif(result.bytes) }))
    for (const entry of [light!, balanced!, strong!]) {
      expect(entry.parsed.lsd.width).toBe(320)
      expect(entry.parsed.lsd.height).toBe(240)
      // NETSCAPE2.0 loop block with repeat 0 (forever).
      expect(new TextDecoder().decode(entry.result.bytes).includes('NETSCAPE2.0')).toBe(true)
      const total = entry.frames.reduce((sum, frame) => sum + frame.delay, 0)
      expect(total).toBe(12 * 50)
    }
    expect(light!.frames).toHaveLength(12)
    expect(balanced!.frames).toHaveLength(6)
    expect(strong!.frames).toHaveLength(4)
    expect(balanced!.frames.map((frame) => frame.delay)).toEqual([100, 100, 100, 100, 100, 100])
    expect(strong!.result.bytes.byteLength).toBeLessThan(balanced!.result.bytes.byteLength)
    expect(balanced!.result.bytes.byteLength).toBeLessThan(light!.result.bytes.byteLength)
    for (const frame of strong!.frames) expect(frame.colorTable.length).toBeLessThanOrEqual(16)
  })

  it('uses the crop for the selected screen', () => {
    const source = makeGif(320, 240, 3)
    const crop = initialCrop({ width: 320, height: 240 }, tall)
    const [light] = compressGif(source, STRENGTHS.slice(0, 1), tall, crop)
    expect([light!.width, light!.height]).toEqual([170, 320])
  })
})

describe('picture compression (ASH-34)', () => {
  beforeAll(async () => {
    const wasm = readFileSync(join(process.cwd(), 'node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
    await initJpeg(await WebAssembly.compile(wasm))
  })

  it('makes baseline MozJPEGs at screen size, smaller with each strength', async () => {
    const results = await compressStill(quadrants(1600, 900), STRENGTHS, wide, null)
    expect(results.map((result) => [result.width, result.height])).toEqual([
      [320, 180],
      [320, 180],
      [320, 180],
    ])
    for (const { bytes } of results) {
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
      // SOF0 (baseline) present, SOF2 (progressive) absent: TJpgDec can read it.
      const hex = Buffer.from(bytes).toString('hex')
      expect(hex.includes('ffc0')).toBe(true)
      expect(hex.includes('ffc2')).toBe(false)
    }
    expect(results[2]!.bytes.byteLength).toBeLessThanOrEqual(results[0]!.bytes.byteLength)
    expect(DEVICE_JPEG_OPTIONS.progressive).toBe(false)
  })

  it('passes the strength quality to the encoder', async () => {
    const seen: number[] = []
    const fake = (async (_image: ImageData, options?: { quality?: number }) => {
      seen.push(options?.quality ?? -1)
      return new ArrayBuffer(8)
    }) as typeof encodeJpeg
    await compressStill(quadrants(64, 48), STRENGTHS, wide, null, fake)
    expect(seen).toEqual([85, 65, 40])
  })
})
