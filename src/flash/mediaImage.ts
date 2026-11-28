import type { Size } from '../crop.ts'
import { MEDIA_HEADER_BYTES } from '../flashLayout.ts'

/**
 * The media image written into the screen's "media" partition: a 4 KB header, then the JPEG,
 * GIF or text design. Keep in step with firmware/main/media_format.h.
 *
 *   0x0000  "ESPM"
 *   0x0004  u16 version (1)
 *   0x0006  u16 kind (1 = JPEG, 2 = GIF, 3 = text design, see src/text/sceneFormat.ts)
 *   0x0008  u16 screen width, u16 screen height
 *   0x000C  u32 payload length
 *   0x0010  u32 CRC-32 of the payload (as in zlib)
 *   0x0014  0xFF up to 0x1000, then the payload
 */
export const MEDIA_MAGIC = 'ESPM'
export const MEDIA_VERSION = 1

export type MediaKind = 'jpeg' | 'gif' | 'scene'

const KIND_CODE: Record<MediaKind, number> = { jpeg: 1, gif: 2, scene: 3 }
const KIND_OF: Record<number, MediaKind> = { 1: 'jpeg', 2: 'gif', 3: 'scene' }

/** The file type a text design travels as inside this site. */
export const SCENE_TYPE = 'application/x-esper-scene'

/** Player version that first plays text designs. */
export const SCENE_PLAYER_VERSION = '1.6.0'

let table: Uint32Array | null = null

/** CRC-32 as used by zlib and PNG. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[i] = c >>> 0
    }
  }
  let value = ~crc >>> 0
  for (let i = 0; i < bytes.length; i++) value = table[(value ^ bytes[i]!) & 0xff]! ^ (value >>> 8)
  return ~value >>> 0
}

export function packMediaImage(kind: MediaKind, payload: Uint8Array, screen: Size): Uint8Array {
  const image = new Uint8Array(MEDIA_HEADER_BYTES + payload.length)
  image.fill(0xff, 0, MEDIA_HEADER_BYTES)
  image.set([...MEDIA_MAGIC].map((char) => char.charCodeAt(0)), 0)
  const view = new DataView(image.buffer)
  view.setUint16(4, MEDIA_VERSION, true)
  view.setUint16(6, KIND_CODE[kind], true)
  view.setUint16(8, screen.width, true)
  view.setUint16(10, screen.height, true)
  view.setUint32(12, payload.length, true)
  view.setUint32(16, crc32(payload), true)
  image.set(payload, MEDIA_HEADER_BYTES)
  return image
}

export type MediaHeader = {
  kind: MediaKind
  screen: Size
  length: number
  crc32: number
}

/** Reads a header back, for checks. Null when it isn't a media image. */
export function readMediaHeader(image: Uint8Array): MediaHeader | null {
  if (image.length < 20 || String.fromCharCode(...image.subarray(0, 4)) !== MEDIA_MAGIC) return null
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  if (view.getUint16(4, true) !== MEDIA_VERSION) return null
  const kind = KIND_OF[view.getUint16(6, true)]
  if (!kind) return null
  return {
    kind,
    screen: { width: view.getUint16(8, true), height: view.getUint16(10, true) },
    length: view.getUint32(12, true),
    crc32: view.getUint32(16, true),
  }
}
