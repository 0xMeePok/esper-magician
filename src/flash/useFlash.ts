import { useCallback, useRef, useState } from 'react'
import { readBoard, saveBoard, type BoardId } from '../boards.ts'
import type { Size } from '../crop.ts'
import { flashLayout, partition } from '../flashLayout.ts'
import { problemFor, type FlashProblem } from './copy.ts'
import { prepareDeviceAsset, type FlashSource } from './deviceAsset.ts'
import { deviceFromUrls, readKnownDevice, saveKnownDevice, type KnownDevice } from './deviceStore.ts'
import { loadFirmware } from './firmware.ts'
import { packMediaImage, readMediaHeader } from './mediaImage.ts'
import { LineBuffer, MAX_LOG_LINES, type Expected, type LogLine } from './serialLog.ts'
import { choosePort, hasWebSerial, ImprovLink, writeOverUsb, type LinkOptions } from './usb.ts'
import { openScreenWindow, sendOverWifi } from './wifi.ts'

export type FlashRoute = 'usb' | 'wifi'

export type FlashState =
  | { phase: 'idle' }
  | { phase: 'preparing'; route: FlashRoute }
  | { phase: 'sending'; route: FlashRoute; fraction: number }
  | { phase: 'restarting' }
  | { phase: 'wifi-setup'; failed: boolean }
  | { phase: 'joining' }
  | { phase: 'done'; route: FlashRoute; wifi: boolean }
  | { phase: 'error'; route: FlashRoute; problem: FlashProblem; detail?: string }

/** The pieces that talk to the outside world, swappable in tests. */
export type FlashDriver = {
  hasWebSerial: typeof hasWebSerial
  choosePort: typeof choosePort
  loadFirmware: typeof loadFirmware
  writeOverUsb: typeof writeOverUsb
  openImprov: (
    port: SerialPort,
    options: LinkOptions,
  ) => Promise<Pick<ImprovLink, 'waitForPlayer' | 'joinWifi' | 'restart' | 'close'>>
  openScreenWindow: typeof openScreenWindow
  sendOverWifi: typeof sendOverWifi
  prepareDeviceAsset: typeof prepareDeviceAsset
}

export const browserDriver: FlashDriver = {
  hasWebSerial,
  choosePort,
  loadFirmware,
  writeOverUsb,
  openImprov: (port, options) => ImprovLink.open(port, options),
  openScreenWindow,
  sendOverWifi,
  prepareDeviceAsset,
}

let activeDriver = browserDriver

/** Tests swap in a fake; pass nothing to restore the real one. */
export function setFlashDriver(next?: FlashDriver) {
  activeDriver = next ?? browserDriver
}

export function busy(state: FlashState): boolean {
  return state.phase === 'preparing' || state.phase === 'sending' || state.phase === 'restarting' || state.phase === 'joining'
}

type Options = {
  screen: Size
  budget: number
  /** What to send, worked out when the button is clicked. */
  source: () => Promise<FlashSource>
}

export function useFlash({ screen, budget, source }: Options) {
  const [state, setState] = useState<FlashState>({ phase: 'idle' })
  const [device, setDevice] = useState<KnownDevice | null>(() => readKnownDevice())
  const [board, setBoard] = useState<BoardId | null>(() => readBoard())
  const [log, setLog] = useState<LogLine[]>([])
  const [expected, setExpected] = useState<Expected | null>(null)
  const [monitoring, setMonitoring] = useState(false)
  const link = useRef<Awaited<ReturnType<FlashDriver['openImprov']>> | null>(null)
  const running = useRef(false)

  const addLog = useCallback((source: LogLine['source'], lines: string[]) => {
    if (lines.length) setLog((all) => [...all, ...lines.map((text) => ({ source, text }))].slice(-MAX_LOG_LINES))
  }, [])

  /** Opens the screen's serial port for Improv and its log. Restarting reads the whole boot log. */
  async function openLink(driver: FlashDriver, port: SerialPort, restart: boolean) {
    const lines = new LineBuffer()
    const opened = await driver.openImprov(port, {
      restart,
      onText: (bytes) => addLog('board', lines.push(bytes)),
      onClose: () => {
        if (link.current === opened) {
          link.current = null
          setMonitoring(false)
        }
      },
    })
    link.current = opened
    setMonitoring(true)
    return opened
  }

  function chooseBoard(id: BoardId) {
    saveBoard(id)
    setBoard(id)
  }

  const fail = useCallback((route: FlashRoute, error: unknown) => {
    setState({ phase: 'error', route, ...problemFor(error) })
  }, [])

  const remember = useCallback((urls: string[]) => {
    const found = deviceFromUrls(urls)
    if (found) {
      saveKnownDevice(found)
      setDevice(found)
    }
    return found
  }, [])

  async function prepareImage(driver: FlashDriver): Promise<Uint8Array> {
    const asset = await driver.prepareDeviceAsset(await source(), screen, budget)
    const image = packMediaImage(asset.kind, asset.bytes, screen)
    const header = readMediaHeader(image)
    if (header) setExpected({ board, crc32: header.crc32, length: header.length })
    return image
  }

  async function closeLink() {
    const open = link.current
    link.current = null
    setMonitoring(false)
    await open?.close().catch(() => {})
  }

  /** First set-up, or whenever Wi-Fi isn't working: the whole install over USB. */
  async function sendOverUsb() {
    const driver = activeDriver
    if (!driver.hasWebSerial()) {
      setState({ phase: 'error', route: 'usb', problem: 'no-serial' })
      return
    }
    if (!board) {
      setState({ phase: 'error', route: 'usb', problem: 'no-board' })
      return
    }
    let port: SerialPort | null
    try {
      port = await driver.choosePort()
    } catch (error) {
      fail('usb', error)
      return
    }
    if (!port) {
      setState({ phase: 'idle' }) // the device list was closed
      return
    }
    // The serial monitor may have the port open; the flasher needs it.
    await closeLink()
    setState({ phase: 'preparing', route: 'usb' })
    setLog([])
    let written = false
    try {
      const [image, firmware] = await Promise.all([prepareImage(driver), driver.loadFirmware(board)])
      const media = partition(flashLayout(), 'media').offset
      setState({ phase: 'sending', route: 'usb', fraction: 0 })
      const esptool = new LineBuffer()
      await driver.writeOverUsb(
        port,
        { chipFamily: firmware.chipFamily, parts: [...firmware.parts, { data: image, address: media }] },
        (fraction) => setState({ phase: 'sending', route: 'usb', fraction }),
        (text) => addLog('esptool', esptool.push(text)),
      )
      written = true
      setState({ phase: 'restarting' })
      // Restarts the screen out of the flasher and reads its boot log from the first line.
      const open = await openLink(driver, port, true)
      const urls = await open.waitForPlayer()
      // The port stays open afterwards, so the log keeps coming until the person stops it.
      if (remember(urls)) setState({ phase: 'done', route: 'usb', wifi: true })
      else setState({ phase: 'wifi-setup', failed: false })
    } catch (error) {
      // Once the picture is on the screen, a Wi-Fi hiccup doesn't undo it.
      if (written) setState({ phase: 'done', route: 'usb', wifi: false })
      else {
        await closeLink()
        fail('usb', error)
      }
    }
  }

  /** Shows the screen's serial output without installing anything. */
  async function watchSerial() {
    if (running.current) return
    const driver = activeDriver
    if (!driver.hasWebSerial()) return
    running.current = true
    try {
      const port = await driver.choosePort()
      if (!port) return
      await closeLink()
      setLog([])
      await openLink(driver, port, false)
    } catch (error) {
      fail('usb', error)
    } finally {
      running.current = false
    }
  }

  async function restartScreen() {
    await link.current?.restart().catch(() => {})
  }

  /** Every time after: hand the picture to the screen's own page on the Wi-Fi. */
  async function sendWirelessly(known: KnownDevice) {
    const driver = activeDriver
    let popup: Window
    try {
      popup = driver.openScreenWindow()
    } catch (error) {
      fail('wifi', error)
      return
    }
    setState({ phase: 'preparing', route: 'wifi' })
    try {
      const image = await prepareImage(driver)
      setState({ phase: 'sending', route: 'wifi', fraction: 0 })
      await driver.sendOverWifi(popup, known, image, screen, (fraction) =>
        setState({ phase: 'sending', route: 'wifi', fraction }),
      )
      setState({ phase: 'done', route: 'wifi', wifi: true })
    } catch (error) {
      if (!popup.closed) popup.close()
      fail('wifi', error)
    }
  }

  // Both start functions open a device list or a window, so they must run straight from a click.
  function start() {
    if (running.current) return
    running.current = true
    const known = readKnownDevice()
    const task = known ? sendWirelessly(known) : sendOverUsb()
    void task.finally(() => {
      running.current = false
    })
  }

  function startUsb() {
    if (running.current) return
    running.current = true
    void sendOverUsb().finally(() => {
      running.current = false
    })
  }

  async function submitWifi(ssid: string, password: string) {
    const open = link.current
    if (!open) return
    setState({ phase: 'joining' })
    try {
      const urls = await open.joinWifi(ssid, password)
      const found = remember(urls)
      setState({ phase: 'done', route: 'usb', wifi: Boolean(found) })
    } catch {
      setState({ phase: 'wifi-setup', failed: true })
    }
  }

  function skipWifi() {
    setState({ phase: 'done', route: 'usb', wifi: false })
  }

  return {
    state,
    device,
    board,
    chooseBoard,
    log,
    expected,
    monitoring,
    usbAvailable: activeDriver.hasWebSerial(),
    start,
    startUsb,
    submitWifi,
    skipWifi,
    watchSerial: () => void watchSerial(),
    restartScreen: () => void restartScreen(),
    stopSerial: () => void closeLink(),
  }
}
