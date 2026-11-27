import type { Firmware } from './firmware.ts'
import { encodeRpc, IMPROV_COMMAND, IMPROV_ERROR, IMPROV_STATE, ImprovParser, type ImprovPacket } from './improv.ts'
import { md5Hex } from './md5.ts'

/** USB-to-serial chips found on ESP32 boards. The ESPER DevKit uses a CP2102. */
export const USB_FILTERS: SerialPortFilter[] = [
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
  { usbVendorId: 0x1a86 }, // WCH CH340 / CH9102
  { usbVendorId: 0x0403 }, // FTDI
  { usbVendorId: 0x303a }, // Espressif's own USB
]

const FLASH_BAUD = 460800
const IMPROV_BAUD = 115200

export type UsbProblem = 'busy' | 'no-response' | 'wrong-chip' | 'unplugged' | 'verify-failed'

export class UsbError extends Error {
  readonly problem: UsbProblem
  constructor(problem: UsbProblem, detail?: string) {
    super(detail ?? problem)
    this.problem = problem
  }
}

export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/**
 * The screen's serial port. Call straight from a click: the first time Chrome shows its device
 * list, and after that it reuses the port this site already has permission for. Null when the
 * person closes the list without choosing.
 */
export async function choosePort(): Promise<SerialPort | null> {
  const granted = (await navigator.serial.getPorts()).filter((port) => {
    const vendor = port.getInfo().usbVendorId
    return USB_FILTERS.some((filter) => filter.usbVendorId === vendor)
  })
  if (granted.length === 1) return granted[0]!
  try {
    return await navigator.serial.requestPort({ filters: USB_FILTERS })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function chipName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Writes the parts with esptool-js (Espressif's flasher, loaded on demand). Each part is checked
 * against the MD5 the ESP32 works out from its flash afterwards. esptool-js's own messages go to
 * `onLog`. The screen stays in the flasher until `ImprovLink.open` restarts it, so its whole boot
 * log can be read. `onProgress` gets 0–1 across all parts.
 */
export async function writeOverUsb(
  port: SerialPort,
  firmware: Pick<Firmware, 'chipFamily' | 'parts'>,
  onProgress: (fraction: number) => void,
  onLog: (text: string) => void = () => {},
): Promise<void> {
  const { ESPLoader, Transport } = await import('esptool-js')
  const transport = new Transport(port, false)
  const parts = firmware.parts
  try {
    const loader = new ESPLoader({
      transport,
      baudrate: FLASH_BAUD,
      romBaudrate: IMPROV_BAUD,
      terminal: { clean: () => {}, write: onLog, writeLine: (line) => onLog(`${line}\n`) },
    })
    try {
      await loader.main()
    } catch (error) {
      const text = describe(error)
      if (/open|NetworkError|InvalidState|busy/i.test(text)) throw new UsbError('busy', text)
      if (/disconnect|lost|NotFoundError/i.test(text)) throw new UsbError('unplugged', text)
      throw new UsbError('no-response', text)
    }
    if (chipName(loader.chip.CHIP_NAME) !== chipName(firmware.chipFamily)) {
      throw new UsbError('wrong-chip', loader.chip.CHIP_NAME)
    }
    const total = parts.reduce((sum, part) => sum + part.data.length, 0)
    const before = parts.map((_, index) =>
      parts.slice(0, index).reduce((sum, part) => sum + part.data.length, 0),
    )
    try {
      await loader.writeFlash({
        fileArray: parts,
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        calculateMD5Hash: md5Hex,
        reportProgress: (index, written, size) => {
          const part = parts[index]?.data.length ?? size
          onProgress((before[index]! + (written / size) * part) / total)
        },
      })
    } catch (error) {
      const text = describe(error)
      if (/MD5/i.test(text)) throw new UsbError('verify-failed', text)
      throw error
    }
    onProgress(1)
  } finally {
    await transport.disconnect().catch(() => {})
  }
}

export type LinkOptions = {
  /** Everything the screen prints that isn't an Improv packet: its boot messages and logs. */
  onText?: (bytes: Uint8Array) => void
  /** Called once when the port goes away or is closed. */
  onClose?: () => void
  /** Restart the screen once listening, so its whole boot log is read. */
  restart?: boolean
}

/**
 * The screen's USB serial port at 115200 baud, once the player is running: Improv Serial for the
 * Wi-Fi details, and the screen's own log output.
 */
export class ImprovLink {
  private readonly port: SerialPort
  private readonly options: LinkOptions
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private readonly parser = new ImprovParser()
  private waiters: Array<(packet: ImprovPacket) => void> = []
  private closed = false
  state: number | null = null
  urls: string[] = []

  private constructor(port: SerialPort, options: LinkOptions) {
    this.port = port
    this.options = options
  }

  static async open(port: SerialPort, options: LinkOptions = {}): Promise<ImprovLink> {
    await port.open({ baudRate: IMPROV_BAUD })
    // Leave EN and BOOT alone, so the screen keeps running.
    await port.setSignals({ dataTerminalReady: false, requestToSend: false })
    const link = new ImprovLink(port, options)
    void link.readLoop()
    if (options.restart) await link.restart()
    return link
  }

  /** Pulses EN through the board's auto-reset circuit, with BOOT left high: a normal start. */
  async restart() {
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: true })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: false })
  }

  private async readLoop() {
    while (!this.closed && this.port.readable) {
      this.reader = this.port.readable.getReader()
      try {
        for (;;) {
          const { value, done } = await this.reader.read()
          if (done) break
          for (const packet of this.parser.push(value)) {
            if (packet.type === 'state') this.state = packet.state
            if (packet.type === 'result' && packet.strings.length) this.urls = packet.strings
            for (const wake of this.waiters.splice(0)) wake(packet)
          }
          const text = this.parser.takeText()
          if (text.length) this.options.onText?.(text)
        }
      } catch {
        // The port went away or was closed; stop reading.
        break
      } finally {
        this.reader.releaseLock()
      }
    }
    this.options.onClose?.()
  }

  private async send(bytes: Uint8Array) {
    const writer = this.port.writable!.getWriter()
    try {
      await writer.write(bytes)
    } finally {
      writer.releaseLock()
    }
  }

  private next(timeoutMs: number): Promise<ImprovPacket | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== wake)
        resolve(null)
      }, timeoutMs)
      const wake = (packet: ImprovPacket) => {
        clearTimeout(timer)
        resolve(packet)
      }
      this.waiters.push(wake)
    })
  }

  /**
   * Waits for the player to start and join the Wi-Fi it already knows. Resolves with its
   * addresses when it is on the Wi-Fi, or [] when it needs Wi-Fi details.
   */
  async waitForPlayer(timeoutMs = 20000, settleMs = 8000): Promise<string[]> {
    const start = Date.now()
    let firstAnswer: number | null = null
    while (Date.now() - start < timeoutMs) {
      await this.send(encodeRpc(IMPROV_COMMAND.state))
      const until = Date.now() + 1000
      while (Date.now() < until) {
        const packet = await this.next(until - Date.now())
        if (!packet) break
        firstAnswer ??= Date.now()
        if (this.state === IMPROV_STATE.provisioned && this.urls.length) return this.urls
      }
      // Once the player answers, give a saved network a few seconds to connect.
      if (firstAnswer !== null && Date.now() - firstAnswer >= settleMs) return []
    }
    if (firstAnswer === null) throw new UsbError('no-response', 'The player did not answer over USB.')
    return []
  }

  /** Sends the Wi-Fi details. Resolves with the screen's addresses once it has joined. */
  async joinWifi(ssid: string, password: string): Promise<string[]> {
    this.urls = []
    await this.send(encodeRpc(IMPROV_COMMAND.wifi, [ssid, password]))
    const end = Date.now() + 40000
    while (Date.now() < end) {
      const packet = await this.next(end - Date.now())
      if (!packet) break
      if (packet.type === 'error' && packet.error === IMPROV_ERROR.unableToConnect) {
        throw new Error('wifi-failed')
      }
      if (packet.type === 'result' && packet.command === IMPROV_COMMAND.wifi) return packet.strings
    }
    throw new Error('wifi-failed')
  }

  async close() {
    this.closed = true
    await this.reader?.cancel().catch(() => {})
    await this.port.close().catch(() => {})
  }
}
