import { describe, expect, it } from 'vitest'
import type { CompressJob, Compressor } from '../compress/client.ts'
import { prepareDeviceAsset, TooBigError } from './deviceAsset.ts'

const screen = { width: 170, height: 320 }

function compressorWith(sizes: number[], seen: CompressJob[] = []): Compressor {
  return async (job) => {
    seen.push(job)
    return (['light', 'balanced', 'strong'] as const).map((strength, index) => ({
      strength,
      bytes: new Uint8Array(sizes[index]!),
      width: 170,
      height: 128,
      frames: 1,
    }))
  }
}

describe('what goes on the screen', () => {
  it('sends a compressed choice exactly as previewed', async () => {
    const bytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const asset = await prepareDeviceAsset({ kind: 'ready', blob: new Blob([bytes]), type: 'image/gif' }, screen, 100, compressorWith([1, 1, 1]))
    expect(asset).toEqual({ kind: 'gif', bytes, strength: null })
  })

  it('makes anything else for the screen, with its crop, at the lightest strength that fits', async () => {
    const seen: CompressJob[] = []
    const crop = { rotationDeg: 90 as const, cropRect: { x: 0, y: 0, width: 10, height: 20 } }
    const blob = new Blob([new Uint8Array(10)], { type: 'image/png' })
    const asset = await prepareDeviceAsset({ kind: 'convert', blob, animated: false, crop }, screen, 50, compressorWith([80, 40, 10], seen))
    expect(asset.kind).toBe('jpeg')
    expect(asset.strength).toBe('balanced')
    expect(seen[0]).toMatchObject({ file: blob, animated: false, screen, crop })

    const gif = await prepareDeviceAsset({ kind: 'convert', blob, animated: true, crop: null }, screen, 100, compressorWith([80, 40, 10]))
    expect(gif).toMatchObject({ kind: 'gif', strength: 'light' })
  })

  it('refuses what cannot fit', async () => {
    const blob = new Blob([new Uint8Array(10)])
    await expect(
      prepareDeviceAsset({ kind: 'convert', blob, animated: true, crop: null }, screen, 5, compressorWith([80, 40, 10])),
    ).rejects.toBeInstanceOf(TooBigError)
    await expect(
      prepareDeviceAsset({ kind: 'ready', blob: new Blob([new Uint8Array(9)]), type: 'image/jpeg' }, screen, 5),
    ).rejects.toBeInstanceOf(TooBigError)
  })
})
