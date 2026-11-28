/**
 * Draws a design's layers into pictures and lays them out for the screen. The same result drives
 * the editor's preview (drawn with a canvas) and what is sent (packed by pack.ts), so they match.
 */
import { gifFrames } from '../compress/gif.ts'
import type { Frame } from '../compress/frames.ts'
import {
  BLINK_MS,
  designSize,
  layerRotation,
  type Box,
  type Design,
  type DesignMedia,
  type Layer,
  type PictureFit,
  type PictureLayer,
  type TextLayer,
} from './design.ts'
import { cssFont } from './fonts.ts'
import { clipFor, isSquare, layerMatrix, moveOnScreen, multiply, orientationMatrix, place, translation, type Matrix } from './geometry.ts'
import { clampClip, hex565, spriteCopies, spriteVisible, type SpriteMotion } from './sceneFormat.ts'

export { layerRotation }

export type Canvas2D = HTMLCanvasElement | OffscreenCanvas
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Size = { width: number; height: number }

/** Steps closer together than this make the screen fall behind; faster text moves further per step. */
export const MIN_STEP_MS = 25
/** The most frames kept from a GIF picture. */
const MAX_GIF_FRAMES = 300

export function makeCanvas(width: number, height: number): Canvas2D {
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

export function context(canvas: Canvas2D): Context2D {
  const ctx = canvas.getContext('2d') as Context2D | null
  if (!ctx) throw new Error('This browser has no 2D canvas.')
  return ctx
}

// ---- Pictures added to a design ----

/** A picture ready to draw: one frame for a still, every frame for a GIF. */
export type MediaSource = {
  width: number
  height: number
  /** The first frame, to draw directly. */
  still: Canvas2D
  /** Every frame with its delay; only for a GIF. */
  frames: { frame: Frame; delay: number }[]
}

export async function loadMediaSource(media: DesignMedia): Promise<MediaSource> {
  if (media.animated) {
    const frames: MediaSource['frames'] = []
    for (const { frame, delay } of gifFrames(await media.blob.arrayBuffer(), { flat: false })) {
      frames.push({ frame, delay })
      if (frames.length >= MAX_GIF_FRAMES) break
    }
    const first = frames[0]
    if (!first) throw new Error('This GIF has no frames.')
    return { width: first.frame.width, height: first.frame.height, still: frameCanvas(first.frame), frames }
  }
  const bitmap = await createImageBitmap(media.blob)
  const still = makeCanvas(bitmap.width, bitmap.height)
  context(still).drawImage(bitmap, 0, 0)
  bitmap.close()
  return { width: still.width, height: still.height, still, frames: [] }
}

export function frameCanvas(frame: Frame, into?: Canvas2D): Canvas2D {
  const canvas = into ?? makeCanvas(frame.width, frame.height)
  const data = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height)
  context(canvas).putImageData(data, 0, 0)
  return canvas
}

/** Where a picture goes inside its box. */
export function fitRect(source: Size, box: Size, fit: PictureFit): { x: number; y: number; width: number; height: number } {
  if (fit === 'stretch') return { x: 0, y: 0, width: box.width, height: box.height }
  const scale = (fit === 'cover' ? Math.max : Math.min)(box.width / source.width, box.height / source.height)
  const width = source.width * scale
  const height = source.height * scale
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height }
}

// ---- Text ----

export function lineHeight(size: number): number {
  return Math.round(size * 1.2)
}

/** Neon glow reach. */
export function glowFor(size: number): number {
  return Math.max(4, Math.round(size * 0.3))
}

/** Breaks text into lines no wider than `maxWidth`; words longer than that break anywhere. */
export function wrapLines(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth || !line) {
        line = candidate
      } else {
        lines.push(line)
        line = word
      }
      // A word too long for a line on its own breaks between letters.
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line)
  }
  return lines
}

function mix(hex: string, toward: string, amount: number): string {
  const a = Number.parseInt(hex.slice(1), 16)
  const b = Number.parseInt(toward.slice(1), 16)
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - amount) + ((b >> shift) & 0xff) * amount)
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

function withAlpha(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(v >> 16) & 0xff}, ${(v >> 8) & 0xff}, ${v & 0xff}, ${alpha})`
}

/** Paints text drawn by `draw` in the layer's colour and effect. */
function paint(ctx: Context2D, layer: TextLayer, draw: () => void) {
  ctx.save()
  ctx.fillStyle = layer.color
  if (layer.effect === 'neon') {
    const glow = glowFor(layer.size)
    ctx.shadowColor = layer.color
    ctx.shadowBlur = glow
    draw()
    draw()
    ctx.shadowBlur = glow * 0.4
    draw()
    ctx.shadowBlur = 0
    ctx.fillStyle = mix(layer.color, '#ffffff', 0.6)
    draw()
  } else {
    draw()
  }
  ctx.restore()
}

const measurer = (() => {
  let ctx: Context2D | null = null
  return (font: string) => {
    ctx ??= context(makeCanvas(1, 1))
    ctx.font = font
    return (text: string) => ctx!.measureText(text).width
  }
})()

/** Text in a straight line, for scrolling sideways. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, '   ').trim()
}

/** Lines placed in a block: each line's text and where its middle sits. */
function placeLines(lines: string[], size: number, top: number, height: number) {
  const lh = lineHeight(size)
  const start = top + (height - lines.length * lh) / 2 + lh / 2
  return lines.map((text, i) => ({ text, y: start + i * lh }))
}

function alignX(align: TextLayer['align'], left: number, width: number) {
  return align === 'left' ? left : align === 'right' ? left + width : left + width / 2
}

/** One piece of a layer, drawn in the layer's own frame. */
export type Part = {
  layerId: string
  canvas: Canvas2D
  /** Where the canvas's top-left corner sits in the layer's box at the start. */
  x: number
  y: number
  box: Box
  rotation: number
  /** Kept inside the box (scrolling text, LED panels) or free to spill out (glow, pictures). */
  clipToBox: boolean
  /** Pixels per step along the layer's own axes, or null when it stays put. */
  move: { dx: number; dy: number; stepMs: number; period: number } | null
  /** Milliseconds shown and hidden; [0, 0] for always shown. */
  blink: readonly [number, number]
  /** The moving picture: drawn frame by frame into the background. */
  gif?: { source: MediaSource; fit: PictureFit }
}

/** How far each step goes and how often, for a speed in pixels per second. */
export function stepFor(speed: number, quantum = 1): { px: number; ms: number } {
  let px = quantum
  while ((1000 * px) / speed < MIN_STEP_MS) px += quantum
  return { px, ms: Math.min(60000, Math.round((1000 * px) / speed)) }
}

function textParts(layer: TextLayer): Part[] {
  const base = { layerId: layer.id, box: boxOf(layer), rotation: layerRotation(layer), blink: BLINK_MS[layer.blink] }
  if (!layer.text.trim()) return []
  if (layer.effect === 'led') return ledParts(layer, base)

  const font = cssFont(layer.font, layer.size)
  const measure = measurer(font)
  const pad = layer.effect === 'neon' ? glowFor(layer.size) : Math.ceil(layer.size * 0.2)
  const { width: bw, height: bh } = layer
  const draw = (canvas: Canvas2D, lines: { text: string; y: number }[], x: number, align: TextLayer['align']) => {
    const ctx = context(canvas)
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.textAlign = align
    paint(ctx, layer, () => lines.forEach((line) => ctx.fillText(line.text, x, line.y)))
    return canvas
  }

  if (layer.scroll === 'none') {
    const lines = placeLines(wrapLines(measure, layer.text, bw), layer.size, pad, bh)
    const canvas = draw(makeCanvas(bw + pad * 2, bh + pad * 2), lines, alignX(layer.align, pad, bw), layer.align)
    return [{ ...base, canvas, x: -pad, y: -pad, clipToBox: false, move: null }]
  }

  const step = stepFor(layer.speed)
  if (layer.scroll === 'left' || layer.scroll === 'right') {
    const text = oneLine(layer.text)
    const width = Math.ceil(measure(text)) + pad * 2
    const canvas = draw(makeCanvas(width, bh), [{ text, y: bh / 2 }], pad, 'left')
    const gap = layer.spacing === 'apart' ? bw : Math.round(layer.size * 0.75)
    const left = layer.scroll === 'left'
    return [
      {
        ...base,
        canvas,
        x: left ? bw : -width,
        y: 0,
        clipToBox: true,
        move: { dx: left ? -step.px : step.px, dy: 0, stepMs: step.ms, period: width + gap },
      },
    ]
  }
  const lines = wrapLines(measure, layer.text, bw)
  const height = lines.length * lineHeight(layer.size) + pad * 2
  const canvas = draw(makeCanvas(bw, height), placeLines(lines, layer.size, 0, height), alignX(layer.align, 0, bw), layer.align)
  const gap = layer.spacing === 'apart' ? bh : Math.round(layer.size * 0.75)
  const up = layer.scroll === 'up'
  return [
    {
      ...base,
      canvas,
      x: 0,
      y: up ? bh : -height,
      clipToBox: true,
      move: { dx: 0, dy: up ? -step.px : step.px, stepMs: step.ms, period: height + gap },
    },
  ]
}

/**
 * The letters as LED dots: `cols` × `rows` cells, lit where the text is. The text is drawn small
 * (one canvas pixel per dot) and each dot is lit when it is mostly covered.
 */
function ledMask(layer: TextLayer, lines: string[], cols: number, rows: number, align: TextLayer['align']): Uint8Array {
  const canvas = makeCanvas(cols, rows)
  const ctx = context(canvas)
  const size = layer.size / layer.dot
  ctx.font = cssFont(layer.font, size)
  ctx.textBaseline = 'middle'
  ctx.textAlign = align
  ctx.fillStyle = '#fff'
  for (const line of placeLines(lines, size, 0, rows)) ctx.fillText(line.text, alignX(align, 0, cols), line.y)
  const data = ctx.getImageData(0, 0, cols, rows).data
  const lit = new Uint8Array(cols * rows)
  for (let i = 0; i < lit.length; i++) lit[i] = data[i * 4 + 3]! >= 110 ? 1 : 0
  return lit
}

function drawDots(ctx: Context2D, lit: Uint8Array | null, cols: number, rows: number, dot: number, color: string, glow: boolean) {
  const r = dot * 0.42
  ctx.save()
  ctx.fillStyle = color
  if (glow) {
    ctx.shadowColor = color
    ctx.shadowBlur = dot * 0.9
  }
  ctx.beginPath()
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (lit && !lit[j * cols + i]) continue
      const cx = (i + 0.5) * dot
      const cy = (j + 0.5) * dot
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
  }
  ctx.fill()
  ctx.restore()
}

function ledParts(layer: TextLayer, base: Pick<Part, 'layerId' | 'box' | 'rotation' | 'blink'>): Part[] {
  const p = layer.dot
  const cols = Math.ceil(layer.width / p)
  const rows = Math.ceil(layer.height / p)
  // The unlit dots: a still panel behind the letters.
  const panel = makeCanvas(cols * p, rows * p)
  drawDots(context(panel), null, cols, rows, p, withAlpha(layer.color, 0.16), false)
  const parts: Part[] = [{ ...base, blink: [0, 0], canvas: panel, x: 0, y: 0, clipToBox: true, move: null }]

  const measure = measurer(cssFont(layer.font, layer.size / p))
  const lit = (lines: string[], c: number, r: number, align: TextLayer['align']) => {
    const canvas = makeCanvas(c * p, r * p)
    drawDots(context(canvas), ledMask(layer, lines, c, r, align), c, r, p, layer.color, true)
    return canvas
  }

  if (layer.scroll === 'none') {
    const lines = wrapLines(measure, layer.text, cols)
    parts.push({ ...base, canvas: lit(lines, cols, rows, layer.align), x: 0, y: 0, clipToBox: true, move: null })
    return parts
  }
  const step = stepFor(layer.speed, p)
  if (layer.scroll === 'left' || layer.scroll === 'right') {
    const text = oneLine(layer.text)
    const c = Math.ceil(measure(text)) + 1
    const gap = layer.spacing === 'apart' ? cols : Math.max(2, Math.round(layer.size / p / 2))
    const left = layer.scroll === 'left'
    parts.push({
      ...base,
      canvas: lit([text], c, rows, 'left'),
      x: left ? cols * p : -c * p,
      y: 0,
      clipToBox: true,
      move: { dx: left ? -step.px : step.px, dy: 0, stepMs: step.ms, period: (c + gap) * p },
    })
    return parts
  }
  const lines = wrapLines(measure, layer.text, cols)
  const r = Math.ceil(lines.length * lineHeight(layer.size / p)) + 1
  const gap = layer.spacing === 'apart' ? rows : Math.max(2, Math.round(layer.size / p / 2))
  const up = layer.scroll === 'up'
  parts.push({
    ...base,
    canvas: lit(lines, cols, r, layer.align),
    x: 0,
    y: up ? rows * p : -r * p,
    clipToBox: true,
    move: { dx: 0, dy: up ? -step.px : step.px, stepMs: step.ms, period: (r + gap) * p },
  })
  return parts
}

function boxOf(layer: Layer): Box {
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
}

function pictureParts(layer: PictureLayer, source: MediaSource | undefined, animated: boolean): Part[] {
  if (!source) return []
  const canvas = makeCanvas(layer.width, layer.height)
  const at = fitRect(source, layer, layer.fit)
  context(canvas).drawImage(source.still, at.x, at.y, at.width, at.height)
  return [
    {
      layerId: layer.id,
      box: boxOf(layer),
      rotation: layer.rotation,
      blink: BLINK_MS[layer.blink],
      canvas,
      x: 0,
      y: 0,
      clipToBox: false,
      move: null,
      ...(animated && source.frames.length > 1 ? { gif: { source, fit: layer.fit } } : {}),
    },
  ]
}

/** Every part of every layer, back to front. */
export function designParts(design: Design, sources: ReadonlyMap<string, MediaSource>): Part[] {
  return design.layers.flatMap((layer, index) => {
    if (layer.kind === 'text') return textParts(layer)
    const media = design.media.find((item) => item.id === layer.mediaId)
    // Only a GIF at the very back moves: the screen draws everything else over it.
    return pictureParts(layer, sources.get(layer.mediaId), index === 0 && Boolean(media?.animated))
  })
}

// ---- Laying it out for the screen ----

export type BuiltSprite = SpriteMotion & { canvas: Canvas2D; layerId: string }

export type PlacedPart = { part: Part; draw: Matrix }

export type BuiltScene = {
  /** The screen's own size (170 × 320), whatever the design's orientation. */
  device: Size
  /** Design pixels to screen pixels. */
  orient: Matrix
  color: string
  color565: number
  /** The screen's backlight, in percent. */
  brightness: number
  /** Drawn once into the background, back to front. */
  baked: PlacedPart[]
  /** The moving picture at the back, if any. */
  gif: PlacedPart | null
  sprites: BuiltSprite[]
}

function isLive(part: Part): boolean {
  return part.move !== null || (part.blink[0] > 0 && part.blink[1] > 0)
}

/**
 * Lays a design out for the screen. Everything behind the first moving or blinking part is
 * drawn once into the background; that part and everything in front become sprites the screen
 * moves itself.
 */
export function buildScene(design: Design, sources: ReadonlyMap<string, MediaSource>, device: Size): BuiltScene {
  const orient = orientationMatrix(design.orientation, designSize(design.orientation, device))
  const parts = designParts(design, sources)
  const matrix = (part: Part) => multiply(orient, layerMatrix(part.box, part.rotation))
  const firstLive = parts.findIndex(isLive)
  const split = firstLive === -1 ? parts.length : firstLive
  const placed = (part: Part): PlacedPart => ({ part, draw: multiply(matrix(part), translation(part.x, part.y)) })
  const behind = parts.slice(0, split).map(placed)
  const gif = behind[0]?.part.gif ? behind[0] : null

  const sprites = parts.slice(split).map((part): BuiltSprite => {
    const m = matrix(part)
    const at = place(m, part.x, part.y, part.canvas.width, part.canvas.height)
    const canvas = makeCanvas(at.w, at.h)
    const ctx = context(canvas)
    // Quarter turns move whole pixels: copy them exactly, unsmoothed.
    ctx.imageSmoothingEnabled = !isSquare(at.draw)
    ctx.setTransform(...at.draw)
    ctx.drawImage(part.canvas, 0, 0)
    const move = part.move ? moveOnScreen(m, part.move.dx, part.move.dy) : { dx: 0, dy: 0 }
    const blinks = part.blink[0] > 0 && part.blink[1] > 0
    return {
      layerId: part.layerId,
      canvas,
      clip: part.clipToBox ? clipFor(m, part.box) : { x: 0, y: 0, w: device.width, h: device.height },
      x: at.x,
      y: at.y,
      w: at.w,
      h: at.h,
      dx: move.dx,
      dy: move.dy,
      stepMs: part.move?.stepMs ?? 0,
      period: part.move?.period ?? 0,
      blinkOnMs: blinks ? part.blink[0] : 0,
      blinkOffMs: blinks ? part.blink[1] : 0,
    }
  })

  return {
    device,
    orient,
    color: design.background,
    color565: hex565(design.background),
    brightness: design.brightness,
    baked: gif ? behind.slice(1) : behind,
    gif,
    sprites,
  }
}

// ---- Drawing on a screen-sized canvas ----

function drawPlaced(ctx: Context2D, placed: PlacedPart, image: CanvasImageSource = placed.part.canvas) {
  ctx.save()
  ctx.setTransform(...placed.draw)
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}

/** The GIF's frame `index` drawn into its box, like the still picture is. */
function gifFrameInBox(placed: PlacedPart, index: number, scratch: { canvas: Canvas2D | null }): Canvas2D {
  const { gif, box } = placed.part
  const frame = gif!.source.frames[index]!.frame
  if (!scratch.canvas || scratch.canvas.width !== frame.width || scratch.canvas.height !== frame.height) {
    scratch.canvas = makeCanvas(frame.width, frame.height)
  }
  frameCanvas(frame, scratch.canvas)
  const boxed = makeCanvas(box.width, box.height)
  const at = fitRect(frame, box, gif!.fit)
  context(boxed).drawImage(scratch.canvas, at.x, at.y, at.width, at.height)
  return boxed
}

/**
 * The background as the screen holds it: the colour, the moving picture's frame `gifIndex`, and
 * every part drawn once.
 */
export function drawBackground(built: BuiltScene, gifIndex = 0, into?: Canvas2D): Canvas2D {
  const canvas = into ?? makeCanvas(built.device.width, built.device.height)
  const ctx = context(canvas)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = built.color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (built.gif) drawPlaced(ctx, built.gif, gifFrameInBox(built.gif, gifIndex, { canvas: null }))
  for (const placed of built.baked) drawPlaced(ctx, placed)
  return canvas
}

/** Which GIF frame shows at `t` ms, as the screen plays it from the start. */
export function gifFrameAt(built: BuiltScene, t: number): number {
  const frames = built.gif?.part.gif?.source.frames
  if (!frames?.length) return 0
  const total = frames.reduce((sum, item) => sum + item.delay, 0)
  let left = total > 0 ? t % total : 0
  for (let i = 0; i < frames.length; i++) {
    left -= frames[i]!.delay
    if (left < 0) return i
  }
  return 0
}

/** Draws every sprite shown at `t` ms over what's already on the canvas. */
export function drawSprites(ctx: Context2D, built: BuiltScene, t: number) {
  for (const sprite of built.sprites) {
    const s = { ...sprite, clip: clampClip(sprite.clip, built.device.width, built.device.height) }
    if (!spriteVisible(s, t) || s.clip.w <= 0 || s.clip.h <= 0) continue
    const copies = spriteCopies(s, t)
    ctx.save()
    ctx.beginPath()
    ctx.rect(s.clip.x, s.clip.y, s.clip.w, s.clip.h)
    ctx.clip()
    for (let k = 0; k < copies.count; k++) ctx.drawImage(sprite.canvas, copies.x + k * copies.stepX, copies.y + k * copies.stepY)
    ctx.restore()
  }
}
