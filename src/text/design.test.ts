import { describe, expect, it } from 'vitest'
import { packMediaImage, readMediaHeader } from '../flash/mediaImage.ts'
import { olderVersion } from '../flash/wifi.ts'
import { animatedPictureId, designSize, newDesign, newTextLayer, parseDesign, type Design } from './design.ts'
import { apply, clipFor, isSquare, layerMatrix, moveOnScreen, multiply, orientationMatrix, place } from './geometry.ts'
import { layerRotation, stepFor, wrapLines, MIN_STEP_MS } from './render.ts'
import { restingTime, designVersion } from './thumbnail.ts'
import { keepInside, largestSize } from './layout.ts'

const SCREEN = { width: 170, height: 320 }

describe('designs', () => {
  it('starts with a sideways LED scroller filling the screen, at full brightness', () => {
    const design = newDesign(SCREEN, 5)
    expect(design.orientation).toBe(90)
    expect(designSize(design.orientation, SCREEN)).toEqual({ width: 320, height: 170 })
    expect(design.layers).toHaveLength(1)
    // Edge to edge, so no bare background shows above and below the panel.
    expect(design.layers[0]).toMatchObject({ kind: 'text', effect: 'led', scroll: 'left', x: 0, y: 0, width: 320, height: 170 })
    expect(design.brightness).toBe(100)
    expect(design.createdAt).toBe(5)
  })

  it('reads a stored design back, mending what it can and dropping what it must', () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const stored = {
      id: 'd1',
      name: 'Shop',
      orientation: 45,
      background: 'red',
      layers: [
        { id: 'a', kind: 'text', text: 'OPEN', size: 9999, effect: 'sparkle', scroll: 'left', x: 1.6, y: 2, width: 3, height: 50 },
        { id: 'b', kind: 'picture', mediaId: 'm1', fit: 'cover', rotation: 10, x: 0, y: 0, width: 50, height: 50 },
        { id: 'c', kind: 'picture', mediaId: 'missing', x: 0, y: 0, width: 50, height: 50 },
        { kind: 'video' },
        'nonsense',
      ],
      media: [{ id: 'm1', name: 'logo.png', type: 'image/png', blob }, { id: 'unused', blob }, { id: 'bad' }],
      createdAt: 1,
      updatedAt: 2,
    }
    const design = parseDesign(stored)!
    expect(design.orientation).toBe(0)
    expect(design.background).toBe('#000000')
    expect(design.brightness).toBe(100)
    expect(parseDesign({ ...stored, brightness: 3 })!.brightness).toBe(10)
    expect(parseDesign({ ...stored, brightness: 55 })!.brightness).toBe(55)
    expect(design.layers.map((layer) => layer.id)).toEqual(['a', 'b'])
    expect(design.layers[0]).toMatchObject({ size: 240, effect: 'plain', scroll: 'left', x: 2, width: 8, font: 'sans' })
    expect(design.media.map((item) => item.id)).toEqual(['m1'])
    expect(parseDesign({ name: 'no id' })).toBeNull()
    expect(parseDesign(null)).toBeNull()
  })

  it('plays only a GIF at the very back', () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/gif' })
    const gif = { id: 'g', name: 'koi.gif', type: 'image/gif', blob, animated: true }
    const picture = { id: 'p', kind: 'picture' as const, mediaId: 'g', fit: 'cover' as const, rotation: 0, blink: 'off' as const, x: 0, y: 0, width: 10, height: 10 }
    const text = newTextLayer(SCREEN)
    const base: Design = { ...newDesign(SCREEN), media: [gif], layers: [picture, text] }
    expect(animatedPictureId(base)).toBe('p')
    expect(animatedPictureId({ ...base, layers: [text, picture] })).toBeNull()
  })

  it('changes its version with anything the screen shows, not its name', () => {
    const design = newDesign(SCREEN)
    expect(designVersion({ ...design, name: 'Other', updatedAt: 99 })).toBe(designVersion(design))
    expect(designVersion({ ...design, background: '#ffffff' })).not.toBe(designVersion(design))
  })
})

describe('keeping layers on the screen', () => {
  const wide = { width: 320, height: 170 }

  it('pulls a box dragged past an edge back on', () => {
    const layer = newTextLayer(wide, { x: -1, y: -3, width: 331, height: 173 })
    expect(keepInside(layer, wide)).toMatchObject({ x: 0, y: 0, width: 320, height: 170 })
    expect(keepInside({ ...layer, x: 300, y: 150, width: 50, height: 40 }, wide)).toMatchObject({ x: 270, y: 130 })
    const fine = newTextLayer(wide, { x: 10, y: 10, width: 100, height: 40 })
    expect(keepInside(fine, wide)).toBe(fine)
  })

  it('keeps a turned box on too, shrinking it if it can never fit', () => {
    // 300 wide turned a quarter is 300 tall: more than 170, so it shrinks.
    const turned = keepInside(newTextLayer(wide, { x: 0, y: 60, width: 300, height: 50, rotation: 90 }), wide)
    const b = { top: turned.y + turned.height / 2 - turned.width / 2, bottom: turned.y + turned.height / 2 + turned.width / 2 }
    expect(b.top).toBeGreaterThanOrEqual(0)
    expect(b.bottom).toBeLessThanOrEqual(170)
    // Tilted boxes reach further than their own size.
    const tilted = keepInside(newTextLayer(wide, { x: 0, y: 0, width: 200, height: 60, rotation: 30 }), wide)
    expect(tilted.x).toBeGreaterThan(0)
    expect(tilted.y).toBeGreaterThan(0)
  })

  it('lets an upright box grow only to the edge', () => {
    expect(largestSize(newTextLayer(wide, { x: 20, y: 30 }), wide)).toEqual({ width: 300, height: 140 })
    expect(largestSize(newTextLayer(wide, { rotation: 90 }), wide)).toBeNull()
  })
})

describe('where things land on the screen', () => {
  it('turns the design onto the screen for every way it can stand', () => {
    const corners = (orientation: 0 | 90 | 180 | 270) => {
      const size = designSize(orientation, SCREEN)
      const m = orientationMatrix(orientation, size)
      return [apply(m, 0, 0), apply(m, size.width, size.height)]
    }
    // Upright: unchanged. Sideways, turned left: the design's top-left is the screen's top-right.
    expect(corners(0)).toEqual([{ x: 0, y: 0 }, { x: 170, y: 320 }])
    expect(corners(90)).toEqual([{ x: 170, y: 0 }, { x: 0, y: 320 }])
    expect(corners(180)).toEqual([{ x: 170, y: 320 }, { x: 0, y: 0 }])
    expect(corners(270)).toEqual([{ x: 0, y: 320 }, { x: 170, y: 0 }])
  })

  it('places quarter-turned pictures on whole pixels, and moves along the turned axis', () => {
    const box = { x: 10, y: 25, width: 301, height: 120 }
    const m = multiply(orientationMatrix(90, { width: 320, height: 170 }), layerMatrix(box, 0))
    expect(isSquare(m)).toBe(true)
    const at = place(m, 301, 0, 400, 120)
    expect(at).toMatchObject({ w: 120, h: 400 })
    expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true)
    expect(at.draw.slice(4).every(Number.isInteger)).toBe(true)
    // Scrolling left on a screen turned left is scrolling up on the screen itself.
    expect(moveOnScreen(m, -2, 0)).toEqual({ dx: 0, dy: -2 })
    expect(clipFor(m, box)).toEqual({ x: 25, y: 10, w: 120, h: 301 })

    // A layer turned a quarter on an upright screen: its box turns about its centre.
    const turned = layerMatrix({ x: 0, y: 0, width: 100, height: 40 }, 90)
    expect(clipFor(turned, { width: 100, height: 40 })).toEqual({ x: 30, y: -30, w: 40, h: 100 })
    expect(moveOnScreen(turned, -3, 0)).toEqual({ dx: 0, dy: -3 })
  })
})

describe('text', () => {
  it('steps far enough per move that the screen keeps up, at the speed asked', () => {
    expect(stepFor(20)).toEqual({ px: 1, ms: 50 })
    expect(stepFor(60)).toEqual({ px: 2, ms: 33 })
    expect(stepFor(240).ms).toBeGreaterThanOrEqual(MIN_STEP_MS)
    // LED text moves a whole dot at a time.
    expect(stepFor(60, 4)).toEqual({ px: 4, ms: 67 })
  })

  it('wraps words to the box, and breaks words longer than a line', () => {
    const measure = (text: string) => text.length * 10
    expect(wrapLines(measure, 'make a sign\nnow', 60)).toEqual(['make a', 'sign', 'now'])
    expect(wrapLines(measure, 'abcdefghij', 40)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('keeps scrolling text to quarter turns', () => {
    const layer = newTextLayer(SCREEN, { rotation: 100, scroll: 'left' })
    expect(layerRotation(layer)).toBe(90)
    expect(layerRotation({ ...layer, scroll: 'none' })).toBe(100)
  })

  it('pictures moving text resting in the middle of its box', () => {
    // Moving up from y = 320 in steps of 2 px every 33 ms, a 100 px strip in a 320 px band.
    const sprite = { x: 0, y: 320, w: 50, h: 100, dx: 0, dy: -2, stepMs: 33, period: 420, blinkOnMs: 0, blinkOffMs: 0, clip: { x: 0, y: 0, w: 50, h: 320 } }
    const steps = restingTime(sprite as never) / 33
    expect(320 - steps * 2).toBe(110)
  })
})

describe('the screen', () => {
  it('labels text designs as kind 3', () => {
    const image = packMediaImage('scene', new Uint8Array([1, 2]), SCREEN)
    expect(image[6]).toBe(3)
    expect(readMediaHeader(image)?.kind).toBe('scene')
  })

  it('tells player versions apart', () => {
    expect(olderVersion('1.5.0', '1.6.0')).toBe(true)
    expect(olderVersion('1.6.0', '1.6.0')).toBe(false)
    expect(olderVersion('1.10.0', '1.6.0')).toBe(false)
    expect(olderVersion('1.6', '1.6.1')).toBe(true)
  })
})
