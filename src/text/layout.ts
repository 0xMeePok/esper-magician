/**
 * Keeps every layer's box on the screen, so none can be dragged, typed or turned where it can't
 * be reached again.
 */
import { layerRotation, MIN_BOX, type Layer } from './design.ts'
import { bounds, layerMatrix } from './geometry.ts'

type Size = { width: number; height: number }

/** The layer's box as it's turned, on the design. */
function extent(layer: Layer) {
  return bounds(layerMatrix(layer, layerRotation(layer)), 0, 0, layer.width, layer.height)
}

/**
 * The layer moved (and if it can't fit at all, shrunk) so its turned box sits wholly on a design
 * of `size`. A layer already on it is returned as it is.
 */
export function keepInside<T extends Layer>(layer: T, size: Size): T {
  let next = layer
  let b = extent(next)
  const turn = ((layerRotation(layer) % 360) + 360) % 360
  let width = layer.width
  let height = layer.height
  if (turn % 90 === 0) {
    // Upright or a quarter turned: each side is capped at the screen's side it lies along.
    const across = turn % 180 === 0 ? size : { width: size.height, height: size.width }
    width = Math.min(width, across.width)
    height = Math.min(height, across.height)
  } else {
    // Tilted: shrink evenly until the tilted box fits.
    const shrink = Math.min(1, size.width / (b.x1 - b.x0), size.height / (b.y1 - b.y0))
    width = Math.max(MIN_BOX, Math.floor(width * shrink))
    height = Math.max(MIN_BOX, Math.floor(height * shrink))
  }
  if (width !== layer.width || height !== layer.height) {
    // Shrunk about its centre.
    next = {
      ...next,
      width,
      height,
      x: Math.round(layer.x + (layer.width - width) / 2),
      y: Math.round(layer.y + (layer.height - height) / 2),
    }
    b = extent(next)
  }
  const dx = b.x0 < 0 ? Math.ceil(-b.x0) : b.x1 > size.width ? Math.floor(size.width - b.x1) : 0
  const dy = b.y0 < 0 ? Math.ceil(-b.y0) : b.y1 > size.height ? Math.floor(size.height - b.y1) : 0
  if (dx === 0 && dy === 0) return next
  return { ...next, x: next.x + dx, y: next.y + dy }
}

/**
 * The most an unturned layer can grow from its top-left corner while staying on the design.
 * Null for turned layers: keepInside keeps those on it.
 */
export function largestSize(layer: Layer, size: Size): Size | null {
  const turn = ((layerRotation(layer) % 360) + 360) % 360
  if (turn !== 0) return null
  return { width: size.width - layer.x, height: size.height - layer.y }
}
