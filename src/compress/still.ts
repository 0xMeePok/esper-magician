import encodeJpeg from '@jsquash/jpeg/encode.js'
import type { ScreenCrop, Size } from '../crop.ts'
import { flatten, transformFrame, type Frame } from './frames.ts'
import type { EncodedResult } from './gif.ts'
import type { Strength } from './strengths.ts'

/**
 * The player decodes JPEG with TJpgDec, which only reads baseline (not progressive) files with
 * 8-bit quantisation tables, so MozJPEG must not use its progressive default.
 */
export const DEVICE_JPEG_OPTIONS = { progressive: false, baseline: true, optimize_coding: true } as const

/** ASH-34: scales a picture to the screen once, then encodes it with MozJPEG at each strength. */
export async function compressStill(
  source: Frame,
  strengths: readonly Strength[],
  screen: Size,
  crop: ScreenCrop | null,
  encode: typeof encodeJpeg = encodeJpeg,
): Promise<EncodedResult[]> {
  const scaled = transformFrame(flatten(source), screen, crop)
  const image = { data: scaled.data, width: scaled.width, height: scaled.height, colorSpace: 'srgb' } as ImageData
  const results: EncodedResult[] = []
  for (const strength of strengths) {
    const buffer = await encode(image, { ...DEVICE_JPEG_OPTIONS, quality: strength.jpegQuality })
    results.push({
      strength: strength.id,
      bytes: new Uint8Array(buffer),
      width: scaled.width,
      height: scaled.height,
      frames: 1,
    })
  }
  return results
}
