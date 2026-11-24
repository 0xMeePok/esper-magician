import { rotatedSize, type ScreenCrop, type Size } from '../crop.ts'

/** Opaque RGBA pixels. */
export type Frame = { data: Uint8ClampedArray; width: number; height: number }

/** Transparent areas become the screen's empty color, the same #2A2A2A as the letterbox bars. */
export const BACKGROUND = [0x2a, 0x2a, 0x2a] as const

/**
 * The output size on the device: a crop fills the screen exactly; otherwise the whole picture
 * fits inside the screen (contain) and is never enlarged.
 */
export function targetSize(source: Size, screen: Size, crop: ScreenCrop | null): Size {
  if (crop) return { width: screen.width, height: screen.height }
  const scale = Math.min(1, screen.width / source.width, screen.height / source.height)
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  }
}

/** Maps a point in the rotated image back to the original image (see crop.test.ts). */
function unrotate(x: number, y: number, turned: Size, rotation: ScreenCrop['rotationDeg']) {
  switch (rotation) {
    case 90:
      return [y, turned.width - x] as const
    case 180:
      return [turned.width - x, turned.height - y] as const
    case 270:
      return [turned.height - y, x] as const
    default:
      return [x, y] as const
  }
}

/** Flattens alpha onto the background so every output pixel is opaque. */
export function flatten(frame: Frame): Frame {
  const out = new Uint8ClampedArray(frame.data.length)
  const src = frame.data
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3]! / 255
    out[i] = Math.round(src[i]! * alpha + BACKGROUND[0] * (1 - alpha))
    out[i + 1] = Math.round(src[i + 1]! * alpha + BACKGROUND[1] * (1 - alpha))
    out[i + 2] = Math.round(src[i + 2]! * alpha + BACKGROUND[2] * (1 - alpha))
    out[i + 3] = 255
  }
  return { data: out, width: frame.width, height: frame.height }
}

/**
 * Turns, crops and scales a frame to what the screen will show. Each output pixel averages an
 * n×n grid of bilinear samples (n grows with the shrink factor, up to 4), which gives clean
 * downscales without a separate filter pass.
 */
export function transformFrame(source: Frame, screen: Size, crop: ScreenCrop | null): Frame {
  const rotation = crop?.rotationDeg ?? 0
  const turned = rotatedSize(source.width, source.height, rotation)
  const rect = crop?.cropRect ?? { x: 0, y: 0, width: turned.width, height: turned.height }
  const size = targetSize(source, screen, crop)
  const stepX = rect.width / size.width
  const stepY = rect.height / size.height
  const samples = Math.min(4, Math.max(1, Math.ceil(Math.max(stepX, stepY))))
  const out = new Uint8ClampedArray(size.width * size.height * 4)
  const src = source.data
  const maxX = source.width - 1
  const maxY = source.height - 1

  const count = samples * samples
  const width = source.width
  for (let oy = 0; oy < size.height; oy++) {
    for (let ox = 0; ox < size.width; ox++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < samples; sy++) {
        const y = rect.y + (oy + (sy + 0.5) / samples) * stepY
        for (let sx = 0; sx < samples; sx++) {
          const x = rect.x + (ox + (sx + 0.5) / samples) * stepX
          const [ux, uy] = unrotate(x, y, turned, rotation)
          // Pixel centers sit at +0.5; clamp so edge pixels repeat instead of reading outside.
          const fx = Math.min(Math.max(ux - 0.5, 0), maxX)
          const fy = Math.min(Math.max(uy - 0.5, 0), maxY)
          const x0 = Math.floor(fx)
          const y0 = Math.floor(fy)
          const x1 = Math.min(x0 + 1, maxX)
          const y1 = Math.min(y0 + 1, maxY)
          const tx = fx - x0
          const ty = fy - y0
          const p00 = (y0 * width + x0) * 4
          const p01 = (y0 * width + x1) * 4
          const p10 = (y1 * width + x0) * 4
          const p11 = (y1 * width + x1) * 4
          const w00 = (1 - tx) * (1 - ty)
          const w01 = tx * (1 - ty)
          const w10 = (1 - tx) * ty
          const w11 = tx * ty
          r += src[p00]! * w00 + src[p01]! * w01 + src[p10]! * w10 + src[p11]! * w11
          g += src[p00 + 1]! * w00 + src[p01 + 1]! * w01 + src[p10 + 1]! * w10 + src[p11 + 1]! * w11
          b += src[p00 + 2]! * w00 + src[p01 + 2]! * w01 + src[p10 + 2]! * w10 + src[p11 + 2]! * w11
        }
      }
      const at = (oy * size.width + ox) * 4
      out[at] = Math.round(r / count)
      out[at + 1] = Math.round(g / count)
      out[at + 2] = Math.round(b / count)
      out[at + 3] = 255
    }
  }
  return { data: out, width: size.width, height: size.height }
}

/** Identifies a crop so a compressed file can be matched to the framing it was made for. */
export function cropKey(crop: ScreenCrop | null | undefined): string {
  if (!crop) return 'none'
  const { x, y, width, height } = crop.cropRect
  return [crop.rotationDeg, x, y, width, height].map((value) => Math.round(value * 100) / 100).join(':')
}
