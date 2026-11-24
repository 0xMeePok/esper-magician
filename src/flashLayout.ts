import type { ScreenId } from './screens.ts'

export type Partition = {
  name: string
  type: 'app' | 'data'
  subtype: string
  offset: number
  size: number
}

export type FlashLayout = {
  flashBytes: number
  partitions: Partition[]
}

const KB = 1024

/**
 * The 4 MB layout from ASH-33: a 640 KB factory app (Wi-Fi + OTA downloader), one OTA slot for
 * the ESPER player or your own program, and a media partition for one picture or GIF.
 * Keep in step with firmware/partitions.csv.
 */
export const FOUR_MB_LAYOUT: FlashLayout = {
  flashBytes: 4096 * KB,
  partitions: [
    { name: 'nvs', type: 'data', subtype: 'nvs', offset: 0x9000, size: 0x5000 },
    { name: 'otadata', type: 'data', subtype: 'ota', offset: 0xe000, size: 0x2000 },
    { name: 'factory', type: 'app', subtype: 'factory', offset: 0x10000, size: 0xa0000 },
    { name: 'ota_0', type: 'app', subtype: 'ota_0', offset: 0xb0000, size: 0x180000 },
    { name: 'media', type: 'data', subtype: '0x40', offset: 0x230000, size: 0x1d0000 },
  ],
}

/** Each screen's board. The 1.9-inch board's flash size is still to be confirmed (ASH-33). */
export const FLASH_LAYOUTS: Record<ScreenId, FlashLayout> = {
  '2.8': FOUR_MB_LAYOUT,
  '1.9': FOUR_MB_LAYOUT,
}

/** The media partition starts with a header the player reads (type, size, CRC). */
export const MEDIA_HEADER_BYTES = 4 * KB

export function partition(layout: FlashLayout, name: string): Partition {
  const found = layout.partitions.find((entry) => entry.name === name)
  if (!found) throw new Error(`No ${name} partition`)
  return found
}

/** Bytes available for one picture or GIF on the selected screen's device. */
export function mediaBudget(screenId: ScreenId): number {
  return partition(FLASH_LAYOUTS[screenId], 'media').size - MEDIA_HEADER_BYTES
}

/** Plain sizes for people: "1.81 MB", "640 KB", "512 bytes". */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} bytes`
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`
  const mb = bytes / (KB * KB)
  return `${mb < 10 ? mb.toFixed(2).replace(/\.?0+$/, '') : mb.toFixed(1).replace(/\.0$/, '')} MB`
}
