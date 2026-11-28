/**
 * Where each part of a design lands on the screen. A part is drawn in its layer's own frame (the
 * layer's box, unturned); the layer turns about its centre, and the whole design turns onto the
 * screen. All of that is one matrix, so the preview and the screen agree.
 */
import type { Box, Orientation } from './design.ts'
import type { SceneRect } from './sceneFormat.ts'

/** A canvas-style matrix: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `outer` after `inner`. */
export function multiply(outer: Matrix, inner: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = outer
  const [a2, b2, c2, d2, e2, f2] = inner
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** Sine and cosine, exact for quarter turns so turned pixels land exactly on pixels. */
function sinCos(degrees: number): [number, number] {
  const turns = ((degrees % 360) + 360) % 360
  if (turns === 0) return [0, 1]
  if (turns === 90) return [1, 0]
  if (turns === 180) return [0, -1]
  if (turns === 270) return [-1, 0]
  const radians = (turns * Math.PI) / 180
  return [Math.sin(radians), Math.cos(radians)]
}

/** Turns clockwise (y points down) about (cx, cy). */
export function rotation(degrees: number, cx = 0, cy = 0): Matrix {
  const [sin, cos] = sinCos(degrees)
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y]
}

/**
 * From the design (as the person sees it) to the screen's own pixels. The design is turned
 * clockwise by `orientation`; holding the screen turned back the other way shows it upright.
 */
export function orientationMatrix(orientation: Orientation, design: { width: number; height: number }): Matrix {
  switch (orientation) {
    case 90:
      return [0, 1, -1, 0, design.height, 0]
    case 180:
      return [-1, 0, 0, -1, design.width, design.height]
    case 270:
      return [0, -1, 1, 0, 0, design.width]
    default:
      return IDENTITY
  }
}

/** From a layer's own frame (its box at the origin, unturned) to the design. */
export function layerMatrix(box: Box, degrees: number): Matrix {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return multiply(rotation(degrees, cx, cy), translation(box.x, box.y))
}

/** True when the matrix only turns by quarter turns (and moves), so pixels map to pixels. */
export function isSquare(m: Matrix): boolean {
  return [m[0], m[1], m[2], m[3]].every((value) => value === 0 || value === 1 || value === -1)
}

/** The smallest rectangle holding the turned rectangle. */
export function bounds(m: Matrix, x: number, y: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const corners = [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)]
  return {
    x0: Math.min(...corners.map((p) => p.x)),
    y0: Math.min(...corners.map((p) => p.y)),
    x1: Math.max(...corners.map((p) => p.x)),
    y1: Math.max(...corners.map((p) => p.y)),
  }
}

/**
 * Where a w×h picture drawn at (x, y) in a frame lands on the screen, snapped to whole pixels:
 * its top-left corner and size there, and the matrix that draws it into a canvas of that size.
 * Quarter turns keep every pixel exact; other angles round outwards.
 */
export function place(m: Matrix, x: number, y: number, w: number, h: number) {
  const b = bounds(m, x, y, w, h)
  const square = isSquare(m)
  const left = square ? Math.round(b.x0) : Math.floor(b.x0)
  const top = square ? Math.round(b.y0) : Math.floor(b.y0)
  const width = Math.max(1, square ? Math.round(b.x1 - b.x0) : Math.ceil(b.x1) - left)
  const height = Math.max(1, square ? Math.round(b.y1 - b.y0) : Math.ceil(b.y1) - top)
  // Draws the picture's own pixels (0..w, 0..h) into the placed canvas.
  const draw = multiply(translation(-left, -top), multiply(m, translation(x, y)))
  const snapped: Matrix = square ? [draw[0], draw[1], draw[2], draw[3], Math.round(draw[4]), Math.round(draw[5])] : draw
  return { x: left, y: top, w: width, h: height, draw: snapped }
}

/** A box's area on the screen, as a clip. */
export function clipFor(m: Matrix, box: { width: number; height: number }): SceneRect {
  const b = bounds(m, 0, 0, box.width, box.height)
  const x = Math.round(b.x0)
  const y = Math.round(b.y0)
  return { x, y, w: Math.round(b.x1) - x, h: Math.round(b.y1) - y }
}

/** A move along the layer's own axis, as whole pixels on the screen. */
export function moveOnScreen(m: Matrix, dx: number, dy: number): { dx: number; dy: number } {
  // Math.round(-0) is -0; keep it a plain 0.
  const round = (value: number) => Math.round(value) || 0
  return { dx: round(m[0] * dx + m[2] * dy), dy: round(m[1] * dx + m[3] * dy) }
}
