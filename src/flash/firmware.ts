import type { BoardId } from '../boards.ts'
import { flashLayout, partition } from '../flashLayout.ts'

export type FirmwarePart = { path: string; offset: number; size: number; sha256: string }

/**
 * public/firmware/esper-1.9/<board>/manifest.json, written by firmware/tools/build_web.sh. The
 * ESP Web Tools format (builds, chipFamily, parts) that ESPVerse uses too, plus the board it was
 * built for and each part's size and SHA-256.
 */
export type FirmwareManifest = {
  name: string
  version: string
  board: BoardId
  mediaOffset: number
  builds: Array<{ chipFamily: string; parts: FirmwarePart[] }>
}

export const FIRMWARE_BASE = '/firmware/esper-1.9/'

export type FlashPart = { data: Uint8Array; address: number }

export type Firmware = { manifest: FirmwareManifest; chipFamily: string; parts: FlashPart[] }

export function parseManifest(value: unknown, board: BoardId): FirmwareManifest {
  const manifest = value as Partial<FirmwareManifest>
  const build = Array.isArray(manifest?.builds) ? manifest.builds[0] : undefined
  if (
    !manifest ||
    typeof manifest.version !== 'string' ||
    typeof manifest.mediaOffset !== 'number' ||
    typeof build?.chipFamily !== 'string' ||
    !Array.isArray(build.parts) ||
    build.parts.length === 0
  ) {
    throw new Error('The firmware description is damaged.')
  }
  // Firmware for another board's wiring leaves this board's backlight dark.
  if (manifest.board !== board) {
    throw new Error(`The firmware for this board is the wrong one (made for ${String(manifest.board)}).`)
  }
  return manifest as FirmwareManifest
}

/** The partition table in the firmware has to put the picture where the website writes it. */
export function checkLayout(manifest: FirmwareManifest) {
  const media = partition(flashLayout(), 'media')
  if (manifest.mediaOffset !== media.offset) {
    throw new Error(
      `The firmware keeps pictures at 0x${manifest.mediaOffset.toString(16)}, ` +
        `but the website writes them at 0x${media.offset.toString(16)}.`,
    )
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Downloads the bootloader, partition table and player built for `board`, checking each against
 * the manifest.
 */
export async function loadFirmware(board: BoardId, fetcher: typeof fetch = fetch): Promise<Firmware> {
  const base = `${FIRMWARE_BASE}${board}/`
  const response = await fetcher(`${base}manifest.json`, { cache: 'no-cache' })
  if (!response.ok) throw new Error('The firmware could not be downloaded.')
  const manifest = parseManifest(await response.json(), board)
  checkLayout(manifest)
  const build = manifest.builds[0]!
  const parts = await Promise.all(
    build.parts.map(async (part) => {
      const file = await fetcher(`${base}${part.path}`, { cache: 'no-cache' })
      if (!file.ok) throw new Error('The firmware could not be downloaded.')
      const data = new Uint8Array(await file.arrayBuffer())
      if (data.length !== part.size || (await sha256(data)) !== part.sha256) {
        throw new Error('The firmware download was damaged. Try again.')
      }
      return { data, address: part.offset }
    }),
  )
  return { manifest, chipFamily: build.chipFamily, parts }
}
