// @vitest-environment node
/**
 * The editor and the player agree on text designs. These tests compile the player's own C code
 * (firmware/main/scene_format.c) on this computer, hand it designs packed by the website, and
 * check it draws every pixel and times every step exactly as sceneFormat.ts says. Skipped where
 * there is no C compiler.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { packMediaImage } from '../flash/mediaImage.ts'
import { SCREEN } from '../screens.ts'
import {
  blend565,
  clampClip,
  composeFrame,
  nextChange,
  packScene,
  rgb565,
  sceneBytes,
  spriteArea,
  spriteAt,
  spriteVisible,
  type Scene,
  type SceneSprite,
} from './sceneFormat.ts'

const root = process.cwd()
const firmware = join(root, 'firmware')
const hasCompiler = spawnSync('cc', ['--version']).status === 0
const work = mkdtempSync(join(tmpdir(), 'esper-scene-'))
const host = join(work, 'scene_host')
const { width: W, height: H } = SCREEN

beforeAll(() => {
  if (!hasCompiler) return
  const sources = ['main/scene_format.c', 'main/media_format.c'].map((file) => join(firmware, file))
  execFileSync('cc', ['-O2', '-I', join(firmware, 'main'), join(firmware, 'test/scene_host.c'), ...sources, '-o', host])
})

type HostResult = {
  header: number
  kind?: number
  crc_ok?: boolean
  scene?: number
  count?: number
  bg?: number
  brightness?: number
  next?: (number | null)[]
  areas?: [number, number, number, number][][]
}

function runHost(scene: Scene | Uint8Array, name: string, times: number[]): { result: HostResult; raw: Buffer } {
  const payload = scene instanceof Uint8Array ? scene : packScene(scene)
  const input = join(work, `${name}.bin`)
  const output = join(work, `${name}.raw`)
  writeFileSync(input, packMediaImage('scene', payload, SCREEN))
  const run = spawnSync(host, [input, output, ...times.map(String)], { encoding: 'utf8' })
  const result = JSON.parse(run.stdout) as HostResult
  let raw = Buffer.alloc(0)
  try {
    raw = readFileSync(output)
  } catch {
    // It stopped before drawing.
  }
  return { result, raw }
}

/** A sprite whose pixels show every alpha and colour mix, with see-through holes. */
function sprite(motion: Omit<SceneSprite, 'pixels'>, seed: number): SceneSprite {
  const pixels = new Uint8Array(motion.w * motion.h * 3)
  for (let y = 0; y < motion.h; y++) {
    for (let x = 0; x < motion.w; x++) {
      const at = (y * motion.w + x) * 3
      const color = rgb565((x * 7 + seed * 40) & 0xff, (y * 5 + seed * 17) & 0xff, (x * y + seed) & 0xff)
      pixels[at] = color & 0xff
      pixels[at + 1] = color >> 8
      pixels[at + 2] = (x + y + seed) % 5 === 0 ? 0 : (x * 13 + y * 29 + seed * 11) % 7 === 0 ? 255 : (x * 31 + y * 17) & 0xff
    }
  }
  return { ...motion, pixels }
}

function testScene(): Scene {
  const pixels = new Uint16Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels[y * W + x] = rgb565(x, y & 0xff, (x + y) & 0xff)
  const still = { dx: 0, dy: 0, stepMs: 0, period: 0, blinkOnMs: 0, blinkOffMs: 0 }
  return {
    background: { kind: 'picture', color: 0, pixels },
    sprites: [
      // Still, hanging off the left edge.
      sprite({ ...still, clip: { x: 0, y: 0, w: W, h: H }, x: -20, y: 30, w: 60, h: 40 }, 1),
      // A marquee: leftwards in a band, copies 150 apart.
      sprite({ ...still, clip: { x: 10, y: 100, w: 150, h: 50 }, x: 160, y: 105, w: 90, h: 30, dx: -3, stepMs: 40, period: 150 }, 2),
      // Downwards and blinking, copies closer than its own height.
      sprite({ ...still, clip: { x: 0, y: 160, w: 120, h: 140 }, x: 20, y: 140, w: 70, h: 45, dy: 2, stepMs: 25, period: 41, blinkOnMs: 300, blinkOffMs: 200 }, 3),
      // Rightwards with no repeats: it leaves for good.
      sprite({ ...still, clip: { x: 0, y: 0, w: W, h: H }, x: 0, y: 250, w: 25, h: 25, dx: 5, stepMs: 100, period: 0 }, 4),
      // Upwards, its clip partly off the screen.
      sprite({ ...still, clip: { x: 100, y: -30, w: 200, h: 90 }, x: 110, y: 40, w: 40, h: 60, dy: -4, stepMs: 33, period: 120 }, 5),
    ],
  }
}

const TIMES = [0, 17, 39, 40, 41, 299, 300, 333, 500, 1000, 1234, 12345, 99999, 3_600_000]

describe('text designs: motion', () => {
  it('moves a marquee by whole steps and wraps it at its period', () => {
    const s = testScene().sprites[1]!
    expect(spriteAt(s, 0)).toEqual({ x: 160, y: 105 })
    expect(spriteAt(s, 39)).toEqual({ x: 160, y: 105 })
    expect(spriteAt(s, 40)).toEqual({ x: 157, y: 105 })
    expect(spriteAt(s, 40 * 50)).toEqual({ x: 160, y: 105 }) // 150 px later: the next copy is here
    expect(nextChange([s], 0)).toBe(40)
    expect(nextChange([s], 40)).toBe(80)
  })

  it('blinks on and off and says when', () => {
    const s = testScene().sprites[2]!
    expect(spriteVisible(s, 0)).toBe(true)
    expect(spriteVisible(s, 299)).toBe(true)
    expect(spriteVisible(s, 300)).toBe(false)
    expect(spriteVisible(s, 500)).toBe(true)
    const blinkOnly = { ...s, dy: 0 }
    expect(nextChange([blinkOnly], 0)).toBe(300)
    expect(nextChange([blinkOnly], 300)).toBe(500)
    expect(spriteArea(s, 300)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(nextChange([], 0)).toBe(Infinity)
  })

  it('mixes colours like the player, from see-through to solid', () => {
    const red = rgb565(255, 0, 0)
    const blue = rgb565(0, 0, 255)
    expect(blend565(blue, red, 0)).toBe(blue)
    expect(blend565(blue, red, 255)).toBe(red)
    // Half way: 128 * 33 / 256 is 16 of 32 steps, so 15 of 31 red and 15 of 31 blue (rounded down).
    expect(blend565(blue, red, 128)).toBe((15 << 11) | 15)
    expect(blend565(blue, red, 254)).toBe(red & 0xf800 | 0)
  })

  it('counts its size before packing', () => {
    const scene = testScene()
    expect(packScene(scene).length).toBe(sceneBytes(scene.background, scene.sprites))
  })
})

describe.skipIf(!hasCompiler)('website → player: text designs', () => {
  it('draws every pixel at every moment exactly as the editor does', () => {
    const scene = testScene()
    const { result, raw } = runHost(scene, 'scene', TIMES)
    expect(result).toMatchObject({ header: 0, kind: 3, crc_ok: true, scene: 0, count: 5, bg: 1 })
    expect(result.next).toEqual(TIMES.map((t) => nextChange(scene.sprites, t)))
    expect(result.areas).toEqual(
      TIMES.map((t) =>
        scene.sprites.map((s) => {
          const area = spriteArea({ ...s, clip: clampClip(s.clip, W, H) }, t)
          return [area.x, area.y, area.w, area.h]
        }),
      ),
    )
    TIMES.forEach((t, index) => {
      const want = composeFrame(scene, t, W, H)
      let mismatches = 0
      for (let i = 0; i < W * H; i++) if (raw.readUInt16LE((index * W * H + i) * 2) !== want[i]) mismatches++
      expect(mismatches, `at ${t} ms`).toBe(0)
    })
  })

  it('reads a design with one colour behind it, or a GIF', () => {
    const scene = testScene()
    const colour = runHost({ ...scene, background: { kind: 'color', color: 0x1234 }, brightness: 35 }, 'colour', [0])
    expect(colour.result).toMatchObject({ scene: 0, bg: 0, brightness: 35 })
    expect(runHost(scene, 'full', [0]).result).toMatchObject({ brightness: 100 })
    // Made before brightness was written: full.
    const older = packScene(scene)
    older[0x14] = 0
    expect(runHost(older, 'older', [0]).result).toMatchObject({ scene: 0, brightness: 100 })
    expect(colour.raw.readUInt16LE((H - 1) * W * 2)).toBe(0x1234)
    const gif = { kind: 'gif', color: 0x4321, bytes: Uint8Array.from([0x47, 0x49, 0x46]) } as const
    expect(runHost({ ...scene, background: gif }, 'gif-bg', [0]).result).toMatchObject({ scene: 0, bg: 2, count: 5 })
  })

  it('refuses damaged designs and ones from a newer website', () => {
    const payload = packScene(testScene())
    const newer = payload.slice()
    newer[4] = 2
    expect(runHost(newer, 'newer', [0]).result).toMatchObject({ scene: -2 })

    // A sprite pointing past the end.
    const past = payload.slice()
    new DataView(past.buffer).setUint32(24 + 28, payload.length - 10, true)
    expect(runHost(past, 'past', [0]).result).toMatchObject({ scene: -1 })

    // Moving on both axes at once.
    const diagonal = payload.slice()
    new DataView(diagonal.buffer).setInt16(24 + 32 + 18, 2, true)
    expect(runHost(diagonal, 'diagonal', [0]).result).toMatchObject({ scene: -1 })

    // A picture background of the wrong size.
    const short = payload.slice()
    new DataView(short.buffer).setUint32(16, W * H * 2 - 2, true)
    expect(runHost(short, 'short', [0]).result).toMatchObject({ scene: -1 })
  })
})
