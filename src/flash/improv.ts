/**
 * Improv Serial (https://www.improv-wifi.com/serial/): how the website gives the screen the Wi-Fi
 * details over USB, and learns the address it uses for wireless updates. Keep in step with
 * firmware/main/improv.c.
 */
export const IMPROV_STATE = { ready: 0x02, provisioning: 0x03, provisioned: 0x04 } as const
export const IMPROV_ERROR = { invalidRpc: 0x01, unknownRpc: 0x02, unableToConnect: 0x03 } as const
export const IMPROV_COMMAND = { wifi: 0x01, state: 0x02, info: 0x03 } as const

const HEADER = [...'IMPROV'].map((char) => char.charCodeAt(0))
const TYPE = { state: 0x01, error: 0x02, rpc: 0x03, result: 0x04 } as const

export type ImprovPacket =
  | { type: 'state'; state: number }
  | { type: 'error'; error: number }
  | { type: 'result'; command: number; strings: string[] }

function frame(type: number, data: number[]): Uint8Array {
  const packet = [...HEADER, 1, type, data.length, ...data]
  const sum = packet.reduce((total, byte) => (total + byte) & 0xff, 0)
  return Uint8Array.from([...packet, sum, 0x0a])
}

function encodeStrings(strings: string[]): number[] {
  const encoder = new TextEncoder()
  const out: number[] = []
  for (const value of strings) {
    const bytes = [...encoder.encode(value)]
    out.push(bytes.length, ...bytes)
  }
  return out
}

/** An RPC command packet. Wi-Fi settings are [ssid, password]. */
export function encodeRpc(command: number, strings: string[] = []): Uint8Array {
  const body = encodeStrings(strings)
  return frame(TYPE.rpc, [command, body.length, ...body])
}

function decodeStrings(data: number[]): string[] {
  const decoder = new TextDecoder()
  const strings: string[] = []
  for (let at = 0; at < data.length; ) {
    const length = data[at]!
    strings.push(decoder.decode(Uint8Array.from(data.slice(at + 1, at + 1 + length))))
    at += 1 + length
  }
  return strings
}

/**
 * Pulls Improv packets out of the serial stream. Everything else (the boot messages and logs that
 * share the same line) is kept as it came, for `takeText`.
 */
export class ImprovParser {
  private buffer: number[] = []
  private text: number[] = []

  push(bytes: Uint8Array): ImprovPacket[] {
    this.buffer.push(...bytes)
    const packets: ImprovPacket[] = []
    for (;;) {
      const start = this.findHeader()
      if (start < 0) {
        // Hold back only an ending that could be the start of a header.
        const keep = this.partialHeaderLength()
        this.text.push(...this.buffer.slice(0, this.buffer.length - keep))
        this.buffer = this.buffer.slice(this.buffer.length - keep)
        return packets
      }
      if (start > 0) {
        this.text.push(...this.buffer.slice(0, start))
        this.buffer = this.buffer.slice(start)
      }
      if (this.buffer.length < 9) return packets
      const length = this.buffer[8]!
      const total = 9 + length + 1
      if (this.buffer.length < total) return packets
      const packet = this.buffer.slice(0, total)
      const sum = packet.slice(0, -1).reduce((all, byte) => (all + byte) & 0xff, 0)
      if (sum !== packet.at(-1) || packet[6] !== 1) {
        // Log text written at the same moment can land inside a packet. Step past this "IMPROV"
        // only, so a real header inside the garbled bytes is still found.
        this.text.push(...this.buffer.slice(0, 1))
        this.buffer = this.buffer.slice(1)
        continue
      }
      this.buffer = this.buffer.slice(total)
      const data = packet.slice(9, 9 + length)
      const type = packet[7]
      if (type === TYPE.state) packets.push({ type: 'state', state: data[0] ?? 0 })
      else if (type === TYPE.error) packets.push({ type: 'error', error: data[0] ?? 0 })
      else if (type === TYPE.result && data.length >= 2) {
        packets.push({ type: 'result', command: data[0]!, strings: decodeStrings(data.slice(2, 2 + data[1]!)) })
      }
    }
  }

  /** The bytes around the Improv packets so far: the board's own log output. */
  takeText(): Uint8Array {
    const out = Uint8Array.from(this.text)
    this.text = []
    return out
  }

  private partialHeaderLength(): number {
    for (let keep = Math.min(HEADER.length - 1, this.buffer.length); keep > 0; keep--) {
      const tail = this.buffer.slice(this.buffer.length - keep)
      if (tail.every((byte, i) => byte === HEADER[i])) return keep
    }
    return 0
  }

  private findHeader(): number {
    outer: for (let i = 0; i + HEADER.length <= this.buffer.length; i++) {
      for (let k = 0; k < HEADER.length; k++) if (this.buffer[i + k] !== HEADER[k]) continue outer
      return i
    }
    return -1
  }
}
