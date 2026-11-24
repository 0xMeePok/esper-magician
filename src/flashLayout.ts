import { FACTORY_APP_ENABLED } from './features.ts'
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
 * Room for the ESPER player program: 384 KB. The player only draws pictures (no Wi-Fi), and its
 * code is about 180 KB, so this leaves about double. Everything after it goes to pictures.
 */
export const PLAYER_APP_BYTES = 384 * KB

/**
 * Default 4 MB layout, factory app off: the player boots straight from 0x10000, and everything
 * after it is media. Keep in step with firmware/partitions.media.csv.
 */
export const PLAYER_ONLY_LAYOUT: FlashLayout = {
  flashBytes: 4096 * KB,
  partitions: [
    { name: 'nvs', type: 'data', subtype: 'nvs', offset: 0x9000, size: 0x7000 },
    { name: 'player', type: 'app', subtype: 'factory', offset: 0x10000, size: PLAYER_APP_BYTES },
    { name: 'media', type: 'data', subtype: '0x40', offset: 0x70000, size: 0x390000 },
  ],
}

/**
 * 4 MB layout with the factory app on (ASH-33): a 640 KB Wi-Fi + OTA downloader, one OTA slot
 * for the player, then media. Keep in step with firmware/partitions.factory.csv.
 */
export const FACTORY_LAYOUT: FlashLayout = {
  flashBytes: 4096 * KB,
  partitions: [
    { name: 'nvs', type: 'data', subtype: 'nvs', offset: 0x9000, size: 0x5000 },
    { name: 'otadata', type: 'data', subtype: 'ota', offset: 0xe000, size: 0x2000 },
    { name: 'factory', type: 'app', subtype: 'factory', offset: 0x10000, size: 0xa0000 },
    { name: 'ota_0', type: 'app', subtype: 'ota_0', offset: 0xb0000, size: PLAYER_APP_BYTES },
    { name: 'media', type: 'data', subtype: '0x40', offset: 0x110000, size: 0x2f0000 },
  ],
}

/**
 * The layout every board is flashed with. Both screens' boards are classic ESP32s with 4 MB of
 * flash (confirmed 2026-11-24), so they share it.
 */
export function flashLayout(factoryApp: boolean = FACTORY_APP_ENABLED): FlashLayout {
  return factoryApp ? FACTORY_LAYOUT : PLAYER_ONLY_LAYOUT
}

/** Each screen's board, with the factory app flag as built. */
export const FLASH_LAYOUTS: Record<ScreenId, FlashLayout> = {
  '2.8': flashLayout(),
  '1.9': flashLayout(),
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
