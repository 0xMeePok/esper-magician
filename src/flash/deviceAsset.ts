import { compressor, type Compressor } from '../compress/client.ts'
import type { EncodedResult } from '../compress/gif.ts'
import type { StrengthId } from '../compress/strengths.ts'
import type { ScreenCrop, Size } from '../crop.ts'
import type { MediaKind } from './mediaImage.ts'

/**
 * What the screen can show: a baseline JPEG or a GIF, no bigger than the screen, made the same way
 * the compression panel makes them. The player decodes only these two.
 */
export type DeviceAsset = {
  kind: MediaKind
  bytes: Uint8Array
  /** The strength that made it, or null when it was already a compressed choice. */
  strength: StrengthId | null
}

export type FlashSource =
  /** Already made for the screen (a compressed choice from ASH-35): sent as it is. */
  | { kind: 'ready'; blob: Blob; type: string }
  /** An original, an example, or the info card: made for the screen first. */
  | { kind: 'convert'; blob: Blob; animated: boolean; crop: ScreenCrop | null }

export class TooBigError extends Error {
  constructor() {
    super('Too big for the screen, even with strong compression.')
  }
}

function kindFor(type: string): MediaKind {
  if (type === 'image/gif') return 'gif'
  if (type === 'image/jpeg') return 'jpeg'
  throw new Error(`The screen can't show ${type || 'this file'}.`)
}

/** The lightest result that fits, like the compression panel picks. */
export function lightestThatFits(results: EncodedResult[], budget: number): EncodedResult | null {
  return results.find((result) => result.bytes.length <= budget) ?? null
}

export async function prepareDeviceAsset(
  source: FlashSource,
  screen: Size,
  budget: number,
  compress: Compressor = compressor(),
): Promise<DeviceAsset> {
  if (source.kind === 'ready') {
    const bytes = new Uint8Array(await source.blob.arrayBuffer())
    if (bytes.length > budget) throw new TooBigError()
    return { kind: kindFor(source.type), bytes, strength: null }
  }
  const results = await compress({
    file: source.blob,
    animated: source.animated,
    screen,
    crop: source.crop,
  })
  const best = lightestThatFits(results, budget)
  if (!best) throw new TooBigError()
  return { kind: source.animated ? 'gif' : 'jpeg', bytes: best.bytes, strength: best.strength }
}
