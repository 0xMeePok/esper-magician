import { cropKey } from '../compress/frames.ts'
import type { ScreenAsset } from '../useScreenContent.ts'

/**
 * What is on the screen, as far as this browser can vouch for it: the item it last sent, and the
 * CRC-32 of the picture the screen stored. A send only counts once the screen accepted that CRC
 * (Wi-Fi) or the chip's MD5 matched (USB), and the screen's own log can overrule it (see
 * `reconcileOnScreen`).
 */
export type OnScreen = {
  /** e.g. "upload:abc" or "example:photo-frame". Null when the screen holds something else. */
  item: string | null
  /** The crop and compression it was sent with, so later edits read as not sent yet. */
  version: string
  crc32: number
  length: number
}

export const ON_SCREEN_STORAGE_KEY = 'esper-magician:on-screen'

/** Which item an asset is, and the version of it that would be sent. */
export function assetIdentity(asset: ScreenAsset | null, uploadId: string | null): { item: string; version: string } | null {
  if (!asset) return null
  if (asset.kind === 'example') return { item: `example:${asset.id}`, version: '' }
  if (!uploadId) return null // an unsaved preview has no tile to mark
  return { item: `upload:${uploadId}`, version: `${cropKey(asset.crop)}|${asset.compressed ?? 'original'}` }
}

/** How an item in the lists is marked. */
export type ItemStatus = 'on-screen' | 'selected' | null

/**
 * "On the screen" for the item the screen holds; "Selected" for the one picked to send next, unless
 * it is already there. A selected item with a newer crop or compression than what was sent reads
 * as selected, because that version isn't on the screen yet.
 */
export function itemStatus(
  item: string,
  selected: { item: string; version: string } | null,
  onScreen: OnScreen | null,
): ItemStatus {
  const there = onScreen?.item === item
  if (selected?.item === item) return there && onScreen!.version === selected.version ? 'on-screen' : 'selected'
  return there ? 'on-screen' : null
}

export function parseOnScreen(value: unknown): OnScreen | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.crc32 !== 'number' || typeof record.length !== 'number') return null
  return {
    item: typeof record.item === 'string' ? record.item : null,
    version: typeof record.version === 'string' ? record.version : '',
    crc32: record.crc32,
    length: record.length,
  }
}

export function readOnScreen(): OnScreen | null {
  try {
    const raw = localStorage.getItem(ON_SCREEN_STORAGE_KEY)
    return raw ? parseOnScreen(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveOnScreen(value: OnScreen | null) {
  try {
    if (value) localStorage.setItem(ON_SCREEN_STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(ON_SCREEN_STORAGE_KEY)
  } catch {
    // Private mode or storage off: nothing is marked as on the screen after a reload.
  }
}

/**
 * Holds what this browser believes against what the screen reported in its log. The same CRC
 * keeps it; the CRC just sent takes over; anything else means the screen holds a picture this
 * browser can't name.
 */
export function reconcileOnScreen(
  current: OnScreen | null,
  pending: OnScreen | null,
  reported: { crc32: number; length: number } | 'none',
): OnScreen | null {
  if (reported === 'none') return null
  const same = (entry: OnScreen | null) => entry && entry.crc32 === reported.crc32 && entry.length === reported.length
  if (same(current)) return current
  if (same(pending)) return pending
  return { item: null, version: '', ...reported }
}
