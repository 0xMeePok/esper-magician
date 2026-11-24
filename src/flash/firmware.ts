import { flashLayout, partition } from '../flashLayout.ts'

/** public/firmware/esper-1.9/manifest.json, written by firmware/tools/build_web.sh. */
export type FirmwareManifest = {
  name: string
  version: string
  chip: string
  mediaOffset: number
  parts: Array<{ path: string; offset: number; size: number; sha256: string }>
}

export const FIRMWARE_BASE = '/firmware/esper-1.9/'

export type FlashPart = { data: Uint8Array; address: number }

export function parseManifest(value: unknown): FirmwareManifest {
  const manifest = value as Partial<FirmwareManifest>
  if (
    !manifest ||
    typeof manifest.version !== 'string' ||
    typeof manifest.mediaOffset !== 'number' ||
    !Array.isArray(manifest.parts) ||
    manifest.parts.length === 0
  ) {
    throw new Error('The firmware description is damaged.')
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

/** Downloads the bootloader, partition table and player, checking each against the manifest. */
export async function loadFirmware(fetcher: typeof fetch = fetch): Promise<{ manifest: FirmwareManifest; parts: FlashPart[] }> {
  const response = await fetcher(`${FIRMWARE_BASE}manifest.json`, { cache: 'no-cache' })
  if (!response.ok) throw new Error('The firmware could not be downloaded.')
  const manifest = parseManifest(await response.json())
  checkLayout(manifest)
  const parts = await Promise.all(
    manifest.parts.map(async (part) => {
      const file = await fetcher(`${FIRMWARE_BASE}${part.path}`, { cache: 'no-cache' })
      if (!file.ok) throw new Error('The firmware could not be downloaded.')
      const data = new Uint8Array(await file.arrayBuffer())
      if (data.length !== part.size || (await sha256(data)) !== part.sha256) {
        throw new Error('The firmware download was damaged. Try again.')
      }
      return { data, address: part.offset }
    }),
  )
  return { manifest, parts }
}
