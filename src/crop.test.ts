import { describe, expect, it } from 'vitest'
import {
  clampRect,
  cropImageLayout,
  describeCrop,
  fitRotated,
  initialCrop,
  largestCenteredRect,
  minCropSize,
  moveRect,
  normalizeRotation,
  parseScreenCrop,
  parseScreenCrops,
  resizeAroundCenter,
  resizeFromCorner,
  rotateCrop,
  rotatePoint,
  rotatedSize,
  withScreenCrop,
  type ImageLayout,
  type ScreenCrop,
} from './crop.ts'

const landscapeScreen = { width: 320, height: 240 }
const portraitScreen = { width: 170, height: 320 }
const photo = { width: 1600, height: 900 }

function ratio(rect: { width: number; height: number }) {
  return rect.width / rect.height
}

/** Maps a point of the rotated source to the box, the way the CSS/canvas layout draws it. */
function project(layout: ImageLayout, source: { width: number; height: number }, x: number, y: number) {
  // Point in the rotated image -> point in the unrotated image.
  const turned = rotatedSize(source.width, source.height, layout.rotation)
  let ox = x
  let oy = y
  if (layout.rotation === 90) [ox, oy] = [y, turned.width - x]
  if (layout.rotation === 180) [ox, oy] = [turned.width - x, turned.height - y]
  if (layout.rotation === 270) [ox, oy] = [turned.height - y, x]
  // Unrotated image -> element pixels -> rotate about the element center.
  const scale = layout.width / source.width
  const ex = ox * scale - layout.width / 2
  const ey = oy * scale - layout.height / 2
  const angle = (layout.rotation * Math.PI) / 180
  const rx = ex * Math.cos(angle) - ey * Math.sin(angle)
  const ry = ex * Math.sin(angle) + ey * Math.cos(angle)
  return { x: layout.left + layout.width / 2 + rx, y: layout.top + layout.height / 2 + ry }
}

describe('crop geometry', () => {
  it('starts from the largest centered rect locked to each screen', () => {
    const wide = initialCrop(photo, landscapeScreen)
    expect(wide.rotationDeg).toBe(0)
    expect(ratio(wide.cropRect)).toBeCloseTo(4 / 3)
    expect(wide.cropRect).toMatchObject({ y: 0, height: 900, width: 1200, x: 200 })

    const tall = initialCrop(photo, portraitScreen)
    expect(ratio(tall.cropRect)).toBeCloseTo(170 / 320)
    expect(tall.cropRect.height).toBe(900)
    expect(tall.cropRect.x).toBeCloseTo((1600 - 900 * (170 / 320)) / 2)

    expect(largestCenteredRect({ width: 320, height: 240 }, 4 / 3)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 240,
    })
  })

  it('never shrinks below half the screen, or half the fit for small sources', () => {
    expect(minCropSize(photo, landscapeScreen)).toEqual({ width: 160, height: 120 })
    const portraitMin = minCropSize(photo, portraitScreen)
    expect(portraitMin.width).toBe(85)
    expect(portraitMin.height).toBeCloseTo(160)

    const tiny = minCropSize({ width: 100, height: 60 }, landscapeScreen)
    expect(tiny.width).toBe(40)
    expect(tiny.height).toBeCloseTo(30)

    const shrunk = resizeAroundCenter(initialCrop(photo, landscapeScreen).cropRect, -5000, photo, landscapeScreen)
    expect(shrunk.width).toBe(160)
    expect(ratio(shrunk)).toBeCloseTo(4 / 3)
  })

  it('keeps moves and resizes inside the picture with the shape locked', () => {
    const start = initialCrop(photo, landscapeScreen).cropRect
    expect(moveRect(start, 10_000, 10_000, photo)).toMatchObject({ x: 400, y: 0 })
    expect(moveRect(start, -10_000, 0, photo)).toMatchObject({ x: 0 })

    const grown = resizeAroundCenter({ x: 600, y: 300, width: 400, height: 300 }, 5000, photo, landscapeScreen)
    expect(grown.width).toBe(1200)
    expect(grown.height).toBe(900)
    expect(grown.x).toBeGreaterThanOrEqual(0)
    expect(grown.x + grown.width).toBeLessThanOrEqual(1600)

    const clamped = clampRect({ x: -50, y: 800, width: 400, height: 300 }, photo, landscapeScreen)
    expect(clamped).toEqual({ x: 0, y: 600, width: 400, height: 300 })
  })

  it('drags a corner while the opposite corner stays put', () => {
    const rect = { x: 400, y: 300, width: 400, height: 300 }
    const se = resizeFromCorner(rect, 'se', { x: 1200, y: 500 }, photo, landscapeScreen)
    expect(se.x).toBe(400)
    expect(se.y).toBe(300)
    expect(se.width).toBe(800)
    expect(ratio(se)).toBeCloseTo(4 / 3)

    const nw = resizeFromCorner(rect, 'nw', { x: -500, y: -500 }, photo, landscapeScreen)
    expect(nw.x + nw.width).toBeCloseTo(800)
    expect(nw.y + nw.height).toBeCloseTo(600)
    expect(nw.y).toBeGreaterThanOrEqual(0)
    expect(nw.x).toBeGreaterThanOrEqual(0)

    const tiny = resizeFromCorner(rect, 'ne', { x: 401, y: 599 }, photo, landscapeScreen)
    expect(tiny.width).toBe(160)
    expect(tiny.x).toBe(400)
    expect(tiny.y + tiny.height).toBeCloseTo(600)
  })

  it('rotates in 90° steps and re-centers an untouched crop', () => {
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
    expect(rotatedSize(1600, 900, 90)).toEqual({ width: 900, height: 1600 })
    expect(rotatePoint(0, 0, photo, 1)).toEqual({ x: 900, y: 0 })
    expect(rotatePoint(0, 0, photo, -1)).toEqual({ x: 0, y: 1600 })

    const turned = rotateCrop(initialCrop(photo, landscapeScreen), 1, photo, landscapeScreen, false)
    expect(turned.rotationDeg).toBe(90)
    expect(turned.cropRect.width).toBe(900)
    expect(turned.cropRect.height).toBe(675)
    expect(turned.cropRect.y).toBeCloseTo((1600 - 675) / 2)

    const back = rotateCrop(turned, -1, photo, landscapeScreen, false)
    expect(back).toEqual(initialCrop(photo, landscapeScreen))
  })

  it('keeps an adjusted crop centered on the same spot after turning', () => {
    const crop: ScreenCrop = { rotationDeg: 0, cropRect: { x: 100, y: 100, width: 400, height: 300 } }
    const turned = rotateCrop(crop, 1, photo, landscapeScreen, true)
    // Center (300, 250) turns clockwise to (900 - 250, 300) = (650, 300).
    expect(turned.cropRect.x + turned.cropRect.width / 2).toBeCloseTo(650)
    expect(turned.cropRect.y + turned.cropRect.height / 2).toBeCloseTo(300)
    expect(turned.cropRect.width).toBe(400)
  })

  it('places the source so the crop fills the box, for every rotation', () => {
    for (const rotationDeg of [0, 90, 180, 270] as const) {
      const turned = rotatedSize(photo.width, photo.height, rotationDeg)
      const fit = largestCenteredRect(turned, 170 / 320)
      const crop: ScreenCrop = {
        rotationDeg,
        cropRect: { x: fit.x / 2, y: fit.y / 2, width: fit.width / 2, height: fit.height / 2 },
      }
      const layout = cropImageLayout(photo, crop, portraitScreen)
      const topLeft = project(layout, photo, crop.cropRect.x, crop.cropRect.y)
      const bottomRight = project(
        layout,
        photo,
        crop.cropRect.x + crop.cropRect.width,
        crop.cropRect.y + crop.cropRect.height,
      )
      expect(topLeft.x).toBeCloseTo(0, 6)
      expect(topLeft.y).toBeCloseTo(0, 6)
      expect(bottomRight.x).toBeCloseTo(170, 6)
      expect(bottomRight.y).toBeCloseTo(320, 6)
    }
  })

  it('fits the whole rotated picture in the work area', () => {
    const fit = fitRotated(photo, 90, { width: 528, height: 388 })
    expect(fit.scale).toBeCloseTo(388 / 1600)
    expect(fit.width).toBeCloseTo(1600 * fit.scale)
  })

  it('describes the crop for screen readers', () => {
    expect(describeCrop({ x: 200, y: 0, width: 1200, height: 900 }, photo)).toBe(
      'Crop area 1200 by 900, centered',
    )
    expect(describeCrop({ x: 0, y: 0, width: 400, height: 300 }, photo)).toBe(
      'Crop area 400 by 300, top left',
    )
    expect(describeCrop({ x: 1200, y: 300, width: 400, height: 300 }, photo)).toBe(
      'Crop area 400 by 300, right',
    )
  })

  it('reads back only valid saved crops', () => {
    const good = { rotationDeg: 90, cropRect: { x: 1, y: 2, width: 3, height: 4 } }
    expect(parseScreenCrop(good)).toEqual(good)
    expect(parseScreenCrop({ ...good, rotationDeg: 45 })).toBeNull()
    expect(parseScreenCrop({ ...good, cropRect: { x: 1, y: 2, width: 0, height: 4 } })).toBeNull()
    expect(parseScreenCrops({ '2.8': good, '1.9': 'nope', '9.9': good })).toEqual({ '2.8': good })
    expect(parseScreenCrops(null)).toEqual({})

    const one = withScreenCrop({}, '1.9', good as ScreenCrop)
    expect(one).toEqual({ '1.9': good })
    expect(withScreenCrop(one, '1.9', null)).toEqual({})
  })
})
