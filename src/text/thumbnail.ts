import type { Design } from './design.ts'
import { invert } from './geometry.ts'
import { buildScene, context, drawBackground, drawSprites, makeCanvas, type BuiltSprite, type Canvas2D, type MediaSource } from './render.ts'
import { designSize } from './design.ts'

/**
 * When a sprite sits nicely in view: scrolling text in the middle of its box (or at its start
 * when longer than the box). For a still picture of a moving design.
 */
export function restingTime(sprite: BuiltSprite): number {
  if (!sprite.stepMs || (!sprite.dx && !sprite.dy) || !sprite.period) return 0
  const horizontal = sprite.dx !== 0
  const step = Math.abs(sprite.dx || sprite.dy)
  const start = horizontal ? sprite.x : sprite.y
  const length = horizontal ? sprite.w : sprite.h
  const clipStart = horizontal ? sprite.clip.x : sprite.clip.y
  const clipLength = horizontal ? sprite.clip.w : sprite.clip.h
  const target = length < clipLength ? clipStart + (clipLength - length) / 2 : clipStart
  const forward = (sprite.dx || sprite.dy) > 0
  const p = sprite.period
  const off = ((((forward ? target - start : start - target) % p) + p) % p)
  return Math.round(off / step) * sprite.stepMs
}

/** The design as a still picture, the way it's held, each sprite where it rests. */
export function stillOfDesign(design: Design, sources: ReadonlyMap<string, MediaSource>, screen: { width: number; height: number }): Canvas2D {
  const built = buildScene(design, sources, screen)
  const device = drawBackground(built, 0)
  const ctx = context(device)
  for (const sprite of built.sprites) drawSprites(ctx, { ...built, sprites: [sprite] }, restingTime(sprite))
  const size = designSize(design.orientation, screen)
  const out = makeCanvas(size.width, size.height)
  const octx = context(out)
  octx.setTransform(...invert(built.orient))
  octx.drawImage(device, 0, 0)
  return out
}

export async function designThumbnail(design: Design, sources: ReadonlyMap<string, MediaSource>, screen: { width: number; height: number }): Promise<Blob> {
  const canvas = stillOfDesign(design, sources, screen)
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture made.'))), 'image/png'),
  )
}

/** Changes whenever anything the screen shows changes, to tell which version is on it. */
export function designVersion(design: Design): string {
  const { updatedAt: _updated, createdAt: _created, name: _name, media, ...shown } = design
  const text = JSON.stringify({ ...shown, media: media.map((item) => [item.id, item.blob.size]) })
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}
