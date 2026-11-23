import type { ScreenId } from './screens.ts'

export type Rotation = 0 | 90 | 180 | 270

export type CropRect = { x: number; y: number; width: number; height: number }

/** A crop saved for one screen. `cropRect` is in pixels of the rotated source image. */
export type ScreenCrop = { rotationDeg: Rotation; cropRect: CropRect }

/** Saved crops for one upload, one entry per screen. A missing entry means uncropped. */
export type ScreenCrops = Partial<Record<ScreenId, ScreenCrop>>

export type Size = { width: number; height: number }

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

export function normalizeRotation(degrees: number): Rotation {
  const turned = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  return turned as Rotation
}

export function rotatedSize(width: number, height: number, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

/** The largest rectangle with the given aspect (width / height) centered inside the bounds. */
export function largestCenteredRect(bounds: Size, aspect: number): CropRect {
  const { width: maxWidth, height: maxHeight } = maxFitSize(bounds, aspect)
  return {
    x: (bounds.width - maxWidth) / 2,
    y: (bounds.height - maxHeight) / 2,
    width: maxWidth,
    height: maxHeight,
  }
}

function maxFitSize(bounds: Size, aspect: number): Size {
  if (bounds.width / bounds.height > aspect) {
    return { width: bounds.height * aspect, height: bounds.height }
  }
  return { width: bounds.width, height: bounds.width / aspect }
}

/**
 * Smallest crop allowed: half the screen's pixels, or half of the largest fitting rect when the
 * source is smaller than the screen, so a crop never blows up a handful of pixels.
 */
export function minCropSize(bounds: Size, screen: Size): Size {
  const aspect = screen.width / screen.height
  const fit = maxFitSize(bounds, aspect)
  const width = Math.min(screen.width, fit.width) / 2
  return { width, height: width / aspect }
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return low
  return Math.min(Math.max(value, low), high)
}

/** Keeps the aspect, the size limits, and the position inside the bounds. */
export function clampRect(rect: CropRect, bounds: Size, screen: Size): CropRect {
  const aspect = screen.width / screen.height
  const fit = maxFitSize(bounds, aspect)
  const min = minCropSize(bounds, screen)
  const width = clamp(rect.width, min.width, fit.width)
  const height = width / aspect
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  return {
    x: clamp(centerX - width / 2, 0, bounds.width - width),
    y: clamp(centerY - height / 2, 0, bounds.height - height),
    width,
    height,
  }
}

export function moveRect(rect: CropRect, dx: number, dy: number, bounds: Size): CropRect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, bounds.width - rect.width),
    y: clamp(rect.y + dy, 0, bounds.height - rect.height),
  }
}

/** Grows or shrinks around the center by `delta` source pixels of width. */
export function resizeAroundCenter(
  rect: CropRect,
  delta: number,
  bounds: Size,
  screen: Size,
): CropRect {
  const aspect = screen.width / screen.height
  const width = rect.width + delta
  const height = width / aspect
  return clampRect(
    {
      x: rect.x + rect.width / 2 - width / 2,
      y: rect.y + rect.height / 2 - height / 2,
      width,
      height,
    },
    bounds,
    screen,
  )
}

/**
 * Drags one corner while the opposite corner stays put. `point` is the pointer in source pixels.
 */
export function resizeFromCorner(
  rect: CropRect,
  corner: Corner,
  point: { x: number; y: number },
  bounds: Size,
  screen: Size,
): CropRect {
  const aspect = screen.width / screen.height
  const west = corner === 'nw' || corner === 'sw'
  const north = corner === 'nw' || corner === 'ne'
  const anchorX = west ? rect.x + rect.width : rect.x
  const anchorY = north ? rect.y + rect.height : rect.y

  const roomX = west ? anchorX : bounds.width - anchorX
  const roomY = north ? anchorY : bounds.height - anchorY
  const maxWidth = Math.min(roomX, roomY * aspect)
  const min = minCropSize(bounds, screen)

  const wanted = Math.max(Math.abs(point.x - anchorX), Math.abs(point.y - anchorY) * aspect)
  const width = clamp(wanted, Math.min(min.width, maxWidth), maxWidth)
  const height = width / aspect
  return {
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height,
  }
}

/** Where a point lands after the image turns 90° (1 = right / clockwise, -1 = left). */
export function rotatePoint(
  x: number,
  y: number,
  bounds: Size,
  direction: 1 | -1,
): { x: number; y: number } {
  return direction === 1 ? { x: bounds.height - y, y: x } : { x: y, y: bounds.width - x }
}

export function turn(rotation: Rotation, direction: 1 | -1): Rotation {
  return normalizeRotation(rotation + direction * 90)
}

/**
 * The crop after a 90° turn. Untouched crops snap back to the largest centered rect. Adjusted
 * crops keep their center (turned with the image) and are clamped into the new bounds.
 */
export function rotateCrop(
  crop: ScreenCrop,
  direction: 1 | -1,
  source: Size,
  screen: Size,
  adjusted: boolean,
): ScreenCrop {
  const rotationDeg = turn(crop.rotationDeg, direction)
  const before = rotatedSize(source.width, source.height, crop.rotationDeg)
  const after = rotatedSize(source.width, source.height, rotationDeg)
  const aspect = screen.width / screen.height
  if (!adjusted) return { rotationDeg, cropRect: largestCenteredRect(after, aspect) }

  const center = rotatePoint(
    crop.cropRect.x + crop.cropRect.width / 2,
    crop.cropRect.y + crop.cropRect.height / 2,
    before,
    direction,
  )
  const width = crop.cropRect.width
  const height = width / aspect
  return {
    rotationDeg,
    cropRect: clampRect(
      { x: center.x - width / 2, y: center.y - height / 2, width, height },
      after,
      screen,
    ),
  }
}

export function initialCrop(source: Size, screen: Size): ScreenCrop {
  return { rotationDeg: 0, cropRect: largestCenteredRect(source, screen.width / screen.height) }
}

export type ImageLayout = {
  left: number
  top: number
  width: number
  height: number
  rotation: Rotation
}

/**
 * Places the unrotated source image inside a box so that the crop fills the box exactly.
 * Use the result as an absolutely positioned element rotated about its center, or with
 * `drawCropped` on a canvas.
 */
export function cropImageLayout(source: Size, crop: ScreenCrop, box: Size): ImageLayout {
  const turned = rotatedSize(source.width, source.height, crop.rotationDeg)
  const scale = box.width / crop.cropRect.width
  const centerX = (turned.width / 2 - crop.cropRect.x) * scale
  const centerY = (turned.height / 2 - crop.cropRect.y) * scale
  const width = source.width * scale
  const height = source.height * scale
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    rotation: crop.rotationDeg,
  }
}

type Drawable = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }

/** Draws `image` turned by `layout.rotation`, matching the CSS placement from `cropImageLayout`. */
export function drawLayout(context: CanvasRenderingContext2D, image: Drawable, layout: ImageLayout) {
  context.save()
  context.translate(layout.left + layout.width / 2, layout.top + layout.height / 2)
  context.rotate((layout.rotation * Math.PI) / 180)
  context.drawImage(image, -layout.width / 2, -layout.height / 2, layout.width, layout.height)
  context.restore()
}

/** Fits the whole rotated source inside a box, centered. Used for the editor work area. */
export function fitRotated(source: Size, rotation: Rotation, box: Size): ImageLayout & { scale: number } {
  const turned = rotatedSize(source.width, source.height, rotation)
  const scale = Math.min(box.width / turned.width, box.height / turned.height)
  const width = source.width * scale
  const height = source.height * scale
  return {
    left: (box.width - width) / 2,
    top: (box.height - height) / 2,
    width,
    height,
    rotation,
    scale,
  }
}

function placement(start: number, size: number, total: number): 'start' | 'center' | 'end' {
  const slack = total - size
  if (slack < 1) return 'center'
  const ratio = start / slack
  if (ratio < 1 / 3) return 'start'
  if (ratio > 2 / 3) return 'end'
  return 'center'
}

/** Spoken summary, e.g. "Crop area 240 by 180, centered". */
export function describeCrop(rect: CropRect, bounds: Size): string {
  const horizontal = placement(rect.x, rect.width, bounds.width)
  const vertical = placement(rect.y, rect.height, bounds.height)
  const size = `Crop area ${Math.round(rect.width)} by ${Math.round(rect.height)}`
  if (horizontal === 'center' && vertical === 'center') return `${size}, centered`
  const words = [
    vertical === 'start' ? 'top' : vertical === 'end' ? 'bottom' : '',
    horizontal === 'start' ? 'left' : horizontal === 'end' ? 'right' : '',
  ].filter(Boolean)
  return `${size}, ${words.join(' ')}`
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseScreenCrop(value: unknown): ScreenCrop | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { rotationDeg?: unknown; cropRect?: unknown }
  if (!ROTATIONS.includes(candidate.rotationDeg as Rotation)) return null
  const rect = candidate.cropRect as Partial<CropRect> | null | undefined
  if (typeof rect !== 'object' || rect === null) return null
  if (![rect.x, rect.y, rect.width, rect.height].every(isFiniteNumber)) return null
  if ((rect.width ?? 0) <= 0 || (rect.height ?? 0) <= 0) return null
  return {
    rotationDeg: candidate.rotationDeg as Rotation,
    cropRect: { x: rect.x!, y: rect.y!, width: rect.width!, height: rect.height! },
  }
}

export function parseScreenCrops(value: unknown): ScreenCrops {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const crops: ScreenCrops = {}
  for (const id of ['2.8', '1.9'] as const) {
    const crop = parseScreenCrop(source[id])
    if (crop) crops[id] = crop
  }
  return crops
}

export function withScreenCrop(crops: ScreenCrops, id: ScreenId, crop: ScreenCrop | null): ScreenCrops {
  const next = { ...crops }
  if (crop) next[id] = crop
  else delete next[id]
  return next
}
