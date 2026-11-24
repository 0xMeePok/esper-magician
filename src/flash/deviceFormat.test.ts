// @vitest-environment node
/**
 * The website and the player agree on the bytes. These tests compile the player's own C code
 * (firmware/main) on this computer and run it on exactly what the website produces: the media
 * image (header, CRC, GIF frames) and the Improv Serial messages. Skipped where there is no C
 * compiler.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decompressFrames, parseGIF } from 'gifuct-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compressGif } from '../compress/gif.ts'
import { STRENGTHS } from '../compress/strengths.ts'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { SCREEN } from '../screens.ts'
import { encodeRpc, IMPROV_COMMAND, IMPROV_ERROR, IMPROV_STATE, ImprovParser } from './improv.ts'
import { crc32, packMediaImage, readMediaHeader } from './mediaImage.ts'

const root = process.cwd()
const firmware = join(root, 'firmware')
const hasCompiler = spawnSync('cc', ['--version']).status === 0
const work = mkdtempSync(join(tmpdir(), 'esper-device-'))
const host = join(work, 'host')
const improvHost = join(work, 'improv_host')

beforeAll(() => {
  if (!hasCompiler) return
  const sources = ['main/gif_decoder.c', 'main/media_format.c'].map((file) => join(firmware, file))
  execFileSync('cc', ['-O2', '-I', join(firmware, 'main'), join(firmware, 'test/host.c'), ...sources, '-o', host])
  execFileSync('cc', ['-I', join(firmware, 'main'), join(firmware, 'test/improv_host.c'), join(firmware, 'main/improv.c'), '-o', improvHost])
})

type HostResult = {
  header: number
  kind?: number
  screen?: [number, number]
  length?: number
  crc_ok?: boolean
  gif?: [number, number]
  delays?: number[]
  frames?: number
  gif_error?: number
}

function runHost(image: Uint8Array, name: string): { result: HostResult; raw: Buffer } {
  const input = join(work, `${name}.bin`)
  const output = join(work, `${name}.raw`)
  writeFileSync(input, image)
  const run = spawnSync(host, [input, output], { encoding: 'utf8' })
  const result = JSON.parse(run.stdout) as HostResult
  let raw = Buffer.alloc(0)
  try {
    raw = readFileSync(output)
  } catch {
    // Not a GIF, or it failed before writing.
  }
  return { result, raw }
}

const rgb565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)

/** A small animated source, like an upload: moving stripes, 40 frames at 40 ms. */
function sourceGif(): Uint8Array {
  const encoder = GIFEncoder()
  const width = 240
  const height = 180
  for (let frame = 0; frame < 40; frame++) {
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        rgba[at] = (x * 3 + frame * 9) % 256
        rgba[at + 1] = (y * 2 + frame * 5) % 256
        rgba[at + 2] = ((x >> 4) + (y >> 4)) % 2 ? 230 : 30
        rgba[at + 3] = 255
      }
    }
    const palette = quantize(rgba, 256)
    encoder.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 40 })
  }
  encoder.finish()
  return encoder.bytes()
}

describe.skipIf(!hasCompiler)('website → player: media image', () => {
  it('matches zlib CRC-32 and the documented header bytes', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const image = packMediaImage('jpeg', Uint8Array.from([0xff, 0xd8, 1, 2, 3]), SCREEN)
    expect(image.length).toBe(4096 + 5)
    expect([...image.subarray(0, 20)]).toEqual([
      0x45, 0x53, 0x50, 0x4d, 1, 0, 1, 0, 170, 0, 64, 1, 5, 0, 0, 0,
      ...new Uint8Array(new Uint32Array([crc32(Uint8Array.from([0xff, 0xd8, 1, 2, 3]))]).buffer),
    ])
    expect(image[20]).toBe(0xff)
    expect(image[4095]).toBe(0xff)
    expect(readMediaHeader(image)).toEqual({
      kind: 'jpeg',
      screen: { width: 170, height: 320 },
      length: 5,
      crc32: crc32(Uint8Array.from([0xff, 0xd8, 1, 2, 3])),
    })

    const { result } = runHost(image, 'jpeg')
    expect(result).toMatchObject({ header: 0, kind: 1, screen: [170, 320], length: 5, crc_ok: true })
  })

  it('draws every frame of each compressed GIF exactly as the website encoded it', { timeout: 60000 }, () => {
    const results = compressGif(sourceGif().slice().buffer as ArrayBuffer, STRENGTHS, SCREEN, null)
    for (const encoded of results) {
      const image = packMediaImage('gif', encoded.bytes, SCREEN)
      const { result, raw } = runHost(image, `gif-${encoded.strength}`)
      expect(result.crc_ok).toBe(true)
      expect(result.gif).toEqual([encoded.width, encoded.height])
      expect(result.frames).toBe(encoded.frames)

      // The reference: gifuct-js, the decoder the website uses, placed like media.c places it.
      const parsed = parseGIF(encoded.bytes.slice().buffer)
      const frames = decompressFrames(parsed, true)
      expect(frames).toHaveLength(result.frames!)
      expect(result.delays).toEqual(frames.map((frame) => (frame.delay < 20 ? 100 : frame.delay)))
      const ox = Math.floor((SCREEN.width - encoded.width) / 2)
      const oy = Math.floor((SCREEN.height - encoded.height) / 2)
      const screenPixels = SCREEN.width * SCREEN.height
      frames.forEach((frame, index) => {
        const { left, top, width, height } = frame.dims
        let mismatches = 0
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4
            if (frame.patch[at + 3] === 0) continue
            const want = rgb565(frame.patch[at]!, frame.patch[at + 1]!, frame.patch[at + 2]!)
            const got = raw.readUInt16LE((index * screenPixels + (oy + top + y) * SCREEN.width + ox + left + x) * 2)
            if (got !== want) mismatches++
          }
        }
        expect(mismatches, `${encoded.strength} frame ${index}`).toBe(0)
      })
      // Outside the picture is the #2A2A2A background.
      if (oy > 0) expect(raw.readUInt16LE(0)).toBe(0x2945)
    }
  })

  it('refuses damaged pictures, pictures for another screen, and empty flash', { timeout: 30000 }, () => {
    const encoded = compressGif(sourceGif().slice().buffer as ArrayBuffer, STRENGTHS, SCREEN, null)[2]!
    const image = packMediaImage('gif', encoded.bytes, SCREEN)
    image[4096 + 100]! ^= 0x55
    expect(runHost(image, 'damaged').result).toMatchObject({ header: 0, crc_ok: false })

    expect(runHost(new Uint8Array(8192).fill(0xff), 'empty').result).toEqual({ header: 1 })
    const newer = packMediaImage('gif', encoded.bytes, SCREEN)
    newer[4] = 2
    expect(runHost(newer, 'newer').result).toEqual({ header: 2 })
    expect(packMediaImage('gif', encoded.bytes, { width: 320, height: 240 })[8]).toBe(64)
  })
})

describe.skipIf(!hasCompiler)('website → player: Improv Serial', () => {
  function talk(...packets: Uint8Array[]) {
    const input = Buffer.concat([Buffer.from('boot noise\r\n'), ...packets.map((packet) => Buffer.from(packet))])
    const run = spawnSync(improvHost, { input })
    return new ImprovParser().push(new Uint8Array(run.stdout))
  }

  it('asks for the state, sends Wi-Fi details, and reads back the addresses', () => {
    expect(talk(encodeRpc(IMPROV_COMMAND.state))).toEqual([{ type: 'state', state: IMPROV_STATE.ready }])

    const joined = talk(encodeRpc(IMPROV_COMMAND.wifi, ['home', 'secret']))
    expect(joined).toEqual([
      { type: 'state', state: IMPROV_STATE.provisioning },
      { type: 'state', state: IMPROV_STATE.provisioned },
      {
        type: 'result',
        command: IMPROV_COMMAND.wifi,
        strings: ['http://192.168.1.23/', 'http://esper-a1b2c3.local/'],
      },
    ])

    const wrong = talk(encodeRpc(IMPROV_COMMAND.wifi, ['home', 'nope']))
    expect(wrong).toContainEqual({ type: 'error', error: IMPROV_ERROR.unableToConnect })
    expect(wrong.at(-1)).toEqual({ type: 'state', state: IMPROV_STATE.ready })

    const info = talk(encodeRpc(IMPROV_COMMAND.info))
    expect(info).toEqual([
      {
        type: 'result',
        command: IMPROV_COMMAND.info,
        strings: ['ESPER player', '1.0.0', 'ESP32', 'ESPER 1.9-inch screen'],
      },
    ])
  })

  it('finds packets split across reads and mixed with log lines', () => {
    const reply = new Uint8Array(spawnSync(improvHost, { input: Buffer.from(encodeRpc(IMPROV_COMMAND.info)) }).stdout)
    const noisy = Uint8Array.from([...Buffer.from('I (312) esper: hello\nIMPRO'), ...reply, ...Buffer.from('\nW (400) wifi\n')])
    const parser = new ImprovParser()
    const found = []
    for (let at = 0; at < noisy.length; at += 7) found.push(...parser.push(noisy.subarray(at, at + 7)))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ type: 'result', command: IMPROV_COMMAND.info })
  })
})
