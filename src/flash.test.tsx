// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { BOARD_STORAGE_KEY } from './boards.ts'
import { FLASH_COPY } from './flash/copy.ts'
import { DEVICE_STORAGE_KEY, readKnownDevice } from './flash/deviceStore.ts'
import { readMediaHeader } from './flash/mediaImage.ts'
import { browserDriver, setFlashDriver, type FlashDriver } from './flash/useFlash.ts'
import { UsbError } from './flash/usb.ts'
import { WifiError } from './flash/wifi.ts'

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 400
  naturalHeight = 600
  #src = ''
  set src(value: string) {
    this.#src = value
    queueMicrotask(() => this.onload?.())
  }
  get src() {
    return this.#src
  }
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const PORT = { getInfo: () => ({ usbVendorId: 0x10c4 }) } as unknown as SerialPort
const URLS = ['http://192.168.1.23/', 'http://esper-a1b2c3.local/']

let root: Root | null = null
let calls: Record<string, unknown[][]>

type Fakes = {
  usb?: boolean
  port?: SerialPort | null
  waitForPlayer?: () => Promise<string[]>
  joinWifi?: (ssid: string, password: string) => Promise<string[]>
  write?: FlashDriver['writeOverUsb']
  sendOverWifi?: FlashDriver['sendOverWifi']
  sendInPage?: FlashDriver['sendInPage']
  findScreen?: FlashDriver['findScreen']
  readLog?: FlashDriver['readLog']
  /** What the fake screen prints once its port is opened, as a real one would. */
  boardOutput?: (sent: { crc32: number; length: number } | null) => string
}

/** The last picture handed to the fake flasher, read back from its header. */
let lastSent: { crc32: number; length: number } | null = null

function fakeDriver(fakes: Fakes = {}): FlashDriver {
  const record = (name: string, ...args: unknown[]) => {
    calls[name] = [...(calls[name] ?? []), args]
  }
  return {
    ...browserDriver,
    hasWebSerial: () => fakes.usb ?? true,
    choosePort: async () => {
      record('choosePort')
      return fakes.port === undefined ? PORT : fakes.port
    },
    loadFirmware: async (board) => {
      record('loadFirmware', board)
      return {
        manifest: { name: 'ESPER player', version: '1.1.0', board, mediaOffset: 0x1d0000, builds: [{ chipFamily: 'ESP32', parts: [] }] },
        chipFamily: 'ESP32',
        parts: [
          { data: new Uint8Array(10), address: 0x1000 },
          { data: new Uint8Array(3), address: 0x8000 },
          { data: new Uint8Array(20), address: 0x10000 },
        ],
      }
    },
    prepareDeviceAsset: async (source, screen, budget) => {
      record('prepare', source, screen, budget)
      return { kind: 'jpeg', bytes: JPEG, strength: 'light' }
    },
    writeOverUsb:
      fakes.write ??
      (async (port, firmware, onProgress, onLog) => {
        record('write', port, firmware.parts)
        const header = readMediaHeader(firmware.parts.at(-1)!.data)
        lastSent = header && { crc32: header.crc32, length: header.length }
        onLog?.('Chip is ESP32-D0WD-V3 (revision v3.1)\n')
        onProgress(0.5)
        await new Promise((resolve) => setTimeout(resolve, 5))
        onProgress(1)
      }),
    openImprov: async (port, options) => {
      record('openImprov', port, options.restart)
      if (fakes.boardOutput) options.onText?.(new TextEncoder().encode(fakes.boardOutput(lastSent)))
      return {
        restart: async () => record('restart'),
        waitForPlayer: fakes.waitForPlayer ?? (async () => []),
        joinWifi:
          fakes.joinWifi ??
          (async (ssid: string, password: string) => {
            record('joinWifi', ssid, password)
            return URLS
          }),
        close: async () => record('closeImprov'),
      }
    },
    openScreenWindow: () => {
      record('openWindow')
      return { closed: false, close: () => record('closeWindow') } as unknown as Window
    },
    readLog:
      fakes.readLog ??
      (async (_device, since) => {
        record('readLog', since)
        return { text: '', start: since, next: since }
      }),
    findScreen:
      fakes.findScreen ??
      (async (url) => {
        record('findScreen', url)
        return { url, localUrl: 'http://esper-49f5c0.local/' }
      }),
    sendInPage:
      fakes.sendInPage ??
      (async (device, image, screen) => {
        record('sendInPage', device, image, screen)
      }),
    sendOverWifi:
      fakes.sendOverWifi ??
      (async (_popup, device, image, screen, onProgress) => {
        record('sendOverWifi', device, image, screen)
        onProgress(0.4)
      }),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  localStorage.setItem(BOARD_STORAGE_KEY, 'devkit-30')
  calls = {}
  lastSent = null
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  setFlashDriver()
  vi.unstubAllGlobals()
})

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  await settle()
  return container
}

async function upload(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([new Uint8Array(500)], 'cat.png', { type: 'image/png' })],
  })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
  await settle(60)
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('missing element')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
}

async function type(input: Element | null, value: string) {
  if (!(input instanceof HTMLInputElement)) throw new Error('missing input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(label: string) {
  return [...document.querySelectorAll('button')].find((element) => element.textContent === label)
}

const usbButton = () => button(FLASH_COPY.sendUsb)
const wifiButton = () => button(FLASH_COPY.sendWifi)

function flashText() {
  return document.querySelector('section.flash')?.textContent ?? ''
}

describe('put it on my screen (ASH-19)', () => {
  it('waits for something to send, and never offers the clock', async () => {
    setFlashDriver(fakeDriver())
    const container = await mount()
    expect(usbButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(wifiButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.nothing)

    const clock = [...container.querySelectorAll('[role="radio"]')].find((row) => row.textContent?.includes('Digital clock'))
    await click(clock)
    await settle()
    expect(usbButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.clock)
    await click(usbButton())
    expect(calls.choosePort).toBeUndefined()
  })

  it('installs over USB the first time, sets up Wi-Fi, and remembers the screen', async () => {
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    expect(usbButton()?.getAttribute('aria-disabled')).toBeNull()
    // Wi-Fi needs the screen's address: from the connect box, or from this USB install.
    expect(wifiButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.connectFirst)
    expect(flashText()).toContain(FLASH_COPY.helperUsb)

    await click(usbButton())
    await settle(60)
    expect(calls.choosePort).toHaveLength(1)

    // The upload fits, so it is made for the screen with its crop (none here).
    const [source, screen] = calls.prepare![0]!
    expect(source).toMatchObject({ kind: 'convert', animated: false, crop: null })
    expect(screen).toMatchObject({ width: 170, height: 320 })

    // Bootloader, partition table, player, then the picture at the media partition (after both player slots).
    const [, parts] = calls.write![0]! as [SerialPort, Array<{ data: Uint8Array; address: number }>]
    expect(parts.map((part) => part.address)).toEqual([0x1000, 0x8000, 0x10000, 0x1d0000])
    expect(readMediaHeader(parts[3]!.data)).toMatchObject({ kind: 'jpeg', screen: { width: 170, height: 320 }, length: JPEG.length })

    // The player has no Wi-Fi yet: ask for it.
    expect(calls.openImprov).toHaveLength(1)
    const form = document.querySelector('form.flash__wifi')
    expect(form?.textContent).toContain(FLASH_COPY.done)
    expect(form?.textContent).toContain(FLASH_COPY.wifiHeading)
    const [name, password] = form!.querySelectorAll('input')
    await type(name!, ' home ')
    await type(password!, 'secret')
    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await settle()
    expect(calls.joinWifi).toEqual([['home', 'secret']])
    expect(flashText()).toContain(FLASH_COPY.done)
    expect(flashText()).toContain(FLASH_COPY.doneWifi)
    expect(readKnownDevice()).toMatchObject({ url: URLS[0], localUrl: URLS[1] })
    expect(flashText()).toContain(FLASH_COPY.helperWifi)
    expect(wifiButton()?.getAttribute('aria-disabled')).toBeNull()
  })

  it('sends over Wi-Fi from this page, with no window or device list', async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: URLS[1], savedAt: 1 }))
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    expect(flashText()).toContain(FLASH_COPY.helperWifi)
    await click(wifiButton())
    await settle()
    expect(calls.choosePort).toBeUndefined()
    expect(calls.openWindow).toBeUndefined()
    const [device, image] = calls.sendInPage![0]! as [unknown, Uint8Array]
    expect(device).toMatchObject({ url: URLS[0] })
    expect(readMediaHeader(image)).toMatchObject({ kind: 'jpeg', length: JPEG.length })
    expect(flashText()).toContain(FLASH_COPY.done)
    expect(flashText()).toContain(FLASH_COPY.doneSentWifi)
    // "Next time…" is for after a USB install, not a Wi-Fi send.
    expect(flashText()).not.toContain(FLASH_COPY.doneWifi)

    // The ✕ clears it.
    await click(document.querySelector(`.flash__status button[aria-label="${FLASH_COPY.dismiss}"]`))
    expect(flashText()).not.toContain(FLASH_COPY.done)
  })

  it('clears "Done" when another item is picked', async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    await click(wifiButton())
    await settle()
    expect(flashText()).toContain(FLASH_COPY.done)

    const photo = [...container.querySelectorAll('[role="radio"]')].find((row) => row.textContent?.includes('Photo frame'))
    await click(photo)
    await settle()
    expect(flashText()).not.toContain(FLASH_COPY.done)
  })

  it("offers the screen's own page when this page can't reach it", async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    setFlashDriver(
      fakeDriver({
        sendInPage: async () => {
          throw new WifiError('unreachable')
        },
      }),
    )
    const container = await mount()
    await upload(container)
    await click(wifiButton())
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Couldn't reach your screen over Wi-Fi/)
    expect(calls.openWindow).toBeUndefined()

    await click(button(FLASH_COPY.screenPage))
    await settle()
    expect(calls.openWindow).toHaveLength(1)
    expect(calls.sendOverWifi).toHaveLength(1)
    expect(flashText()).toContain(FLASH_COPY.done)
  })

  it('says plainly what went wrong over USB, and goes quiet if the device list is closed', async () => {
    // The person looks at the list, then closes it.
    const closed = fakeDriver({ port: null })
    const later = Date.now() + 1000
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    setFlashDriver({
      ...closed,
      choosePort: async () => {
        const port = await closed.choosePort()
        vi.mocked(Date.now).mockImplementation(() => later + 1000)
        return port
      },
    })
    const container = await mount()
    await upload(container)
    await click(usbButton())
    await settle()
    vi.mocked(Date.now).mockRestore()
    expect(calls.prepare).toBeUndefined()
    expect(document.querySelector('[role="alert"]')).toBeNull()

    setFlashDriver(
      fakeDriver({
        write: async () => {
          throw new UsbError('busy')
        },
      }),
    )
    await click(usbButton())
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Another app is using/)
  })

  it('works without USB in browsers that have none: connect over Wi-Fi, then send', async () => {
    setFlashDriver(fakeDriver({ usb: false }))
    const container = await mount()
    await upload(container)
    expect(usbButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(wifiButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.connectFirst)
    expect(container.querySelector('.flash__connect')).toBeTruthy()
    expect(container.querySelector('.flash__usb')).toBeNull()

    act(() => root?.unmount())
    root = null
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    const again = await mount()
    await upload(again)
    expect(wifiButton()?.getAttribute('aria-disabled')).toBeNull()
    expect(usbButton()?.getAttribute('aria-disabled')).toBe('true')
  })

  it('starts on the 30-pin board, lets another be picked, and installs the firmware built for it', async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY)
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    expect(container.querySelector<HTMLInputElement>('input[name="esper-board"][value="devkit-30"]')?.checked).toBe(true)
    expect(usbButton()?.getAttribute('aria-disabled')).toBeNull()

    const thirtyEight = container.querySelector('input[name="esper-board"][value="devkit-38"]')
    await click(thirtyEight)
    expect(localStorage.getItem(BOARD_STORAGE_KEY)).toBe('devkit-38')
    await click(usbButton())
    await settle(60)
    expect(calls.loadFirmware).toEqual([['devkit-38']])
  })

  it("says so when the browser can't show the list of USB devices", async () => {
    // As in the Claude app's built-in browser: the list "closes" the moment it's asked for.
    setFlashDriver({ ...fakeDriver(), choosePort: async () => null })
    const container = await mount()
    await upload(container)
    await click(usbButton())
    await settle()
    expect(flashText()).toContain("this browser didn't show the list of USB devices")
  })

  it("shows the screen's serial output and what it says about the picture", async () => {
    setFlashDriver(
      fakeDriver({
        boardOutput: (sent) =>
          [
            'rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)',
            '\x1b[0;32mI (412) esper: ESPER player 1.1.0 on a 170x320 screen\x1b[0m',
            'I (413) esper: board devkit-30: 1.9-inch ST7789 on an ESP32 DevKit 30-pin, BLK GPIO 17, button GPIO 16',
            `I (520) media: JPEG, ${sent!.length} bytes, CRC 0x${sent!.crc32.toString(16).padStart(8, '0')} OK`,
            'I (560) media: drew JPEG 170x320 at (0,0)',
            'I (561) esper: backlight on: showing the picture',
            '',
          ].join('\r\n'),
      }),
    )
    const container = await mount()
    await upload(container)
    await click(usbButton())
    await settle(60)
    expect(calls.openImprov![0]![1]).toBe(true) // restarted, so the whole boot log is read

    // Wi-Fi lines are shown first; everything is one click away.
    await click(document.querySelector('input[name="serial-view"][value="all"]'))
    const log = document.querySelector('.serial__log')?.textContent ?? ''
    expect(log).toContain('[esptool] Chip is ESP32-D0WD-V3')
    expect(log).toContain('rst:0x1 (POWERON_RESET)')
    expect(log).toContain('I (412) esper: ESPER player 1.1.0 on a 170x320 screen')
    expect(log).not.toContain('\x1b')

    const checks = [...document.querySelectorAll('.serial__check')].map((item) => [item.className, item.textContent])
    expect(checks.every(([className]) => className!.includes('--ok'))).toBe(true)
    expect(checks.map(([, text]) => text).join(' ')).toContain('Picture matches what this site sent')
  })

  it('flags firmware built for the other board', async () => {
    setFlashDriver(
      fakeDriver({
        boardOutput: () =>
          'I (413) esper: board devkit-38: 1.9-inch ST7789 on an ESP32 DevKit 38-pin, BLK GPIO 32, button GPIO 33\r\n',
      }),
    )
    const container = await mount()
    await upload(container)
    await click(usbButton())
    await settle(60)
    const bad = document.querySelector('.serial__check--bad')?.textContent
    expect(bad).toContain('Built for devkit-38, not devkit-30')
  })

  it('marks an upload "Selected" until it is flashed, then "On the screen" while the board agrees', async () => {
    let report = (sent: { crc32: number; length: number } | null) =>
      `I (520) media: JPEG, ${sent!.length} bytes, CRC 0x${sent!.crc32.toString(16).padStart(8, '0')} OK\r\n`
    setFlashDriver(fakeDriver({ boardOutput: (sent) => report(sent) }))
    const container = await mount()
    await upload(container)
    await settle(60)
    const tile = () => container.querySelector('.upload-tile')?.getAttribute('aria-label')
    expect(tile()).toBe('cat.png, picture, Selected')
    expect(container.querySelector('.upload-scrim--selected')?.textContent).toBe('Selected')

    await click(usbButton())
    await settle(60)
    expect(tile()).toBe('cat.png, picture, On the screen')
    expect(container.querySelector('.upload-scrim--selected')).toBeNull()

    // The board now reports a picture this browser didn't send: nothing is marked.
    report = () => 'I (520) media: JPEG, 99 bytes, CRC 0xdeadbeef OK\r\n'
    await click([...document.querySelectorAll('button')].find((button) => button.textContent === FLASH_COPY.wifiSkip))
    await click(usbButton())
    await settle(60)
    expect(tile()).toBe('cat.png, picture, Selected')
    expect(container.textContent).not.toContain('On the screen')
  })

  it("shows the screen's Wi-Fi when the screen is dark, and sends to it over Wi-Fi on request", async () => {
    setFlashDriver(
      fakeDriver({
        boardOutput: () =>
          [
            'I (631) esper: ESPER player 1.3.0 on a 170x320 screen',
            'I (640) setup: no Wi-Fi saved yet',
            'I (650) setup: hotspot on: join "ESPER-49F5C0" (no password), then open http://192.168.4.1/',
            'I (650) media: GIF, 58005 bytes, CRC 0xa7f3673f OK',
            'I (9000) network: joining "penstamp"',
            'I (9121) wifi:connected with penstamp, aid = 1, channel 11, BW20, bssid = 20:e1:5d:6e:81:08',
            'I (9121) wifi:security: WPA2-PSK, phy: bgn, rssi: -51, cipher(pairwise:0x3, group:0x3), pmf:0',
            'I (9671) network: on Wi-Fi at http://192.168.0.16/ (also http://esper-49f5c0.local/)',
            '',
          ].join('\r\n'),
      }),
    )
    const container = await mount()
    await upload(container)
    await click(usbButton())
    await settle(60)

    const card = () => document.querySelector('.serial__screen')?.textContent ?? ''
    expect(card()).toContain('ESPER-49F5C0')
    expect(card()).toContain('On Wi-Fi penstamp · signal strong (-51 dBm)')
    expect(card()).toContain('http://192.168.0.16/')

    // The Wi-Fi view leaves out everything that isn't about Wi-Fi.
    const log = document.querySelector('.serial__log')?.textContent ?? ''
    expect(log).toContain('setup: hotspot on')
    expect(log).toContain('wifi:connected with penstamp')
    expect(log).not.toContain('media: GIF')
    expect(log).not.toContain('[esptool]')

    localStorage.removeItem(DEVICE_STORAGE_KEY)
    await click(button(FLASH_COPY.useThisScreen))
    expect(readKnownDevice()).toMatchObject({ url: 'http://192.168.0.16/', localUrl: 'http://esper-49f5c0.local/' })
    expect(card()).toContain(FLASH_COPY.screenInUse)
    await click(button(FLASH_COPY.wifiSkip)) // the Improv Wi-Fi form isn't needed: it's already on
    expect(wifiButton()?.getAttribute('aria-disabled')).toBeNull()
  })

  it('connects to an already set-up screen by its Wi-Fi name, with no USB, then sends to it', async () => {
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    const input = container.querySelector('.flash__connect input')
    await type(input, ' ESPER-49F5C0 ')
    await act(async () => {
      container.querySelector('.flash__connect')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await settle()
    expect(calls.findScreen).toEqual([['http://esper-49f5c0.local/']])
    expect(readKnownDevice()).toMatchObject({ url: 'http://esper-49f5c0.local/' })
    expect(flashText()).toContain(`${FLASH_COPY.sendingTo} http://esper-49f5c0.local/`)
    expect(calls.choosePort).toBeUndefined()

    await click(wifiButton())
    await settle()
    expect(calls.sendInPage).toHaveLength(1)
    expect(flashText()).toContain(FLASH_COPY.done)

    // "Change" forgets it, to connect another.
    await click(button(FLASH_COPY.change))
    expect(readKnownDevice()).toBeNull()
    expect(container.querySelector('.flash__connect')).toBeTruthy()
  })

  it("explains when it can't find the screen, and can keep the address anyway", async () => {
    setFlashDriver(
      fakeDriver({
        findScreen: async () => {
          throw new WifiError('unreachable')
        },
      }),
    )
    const container = await mount()
    await upload(container)
    const submit = async (value: string) => {
      await type(container.querySelector('.flash__connect input'), value)
      await act(async () => {
        container.querySelector('.flash__connect')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await settle()
    }
    await submit('https://example.com/')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(FLASH_COPY.connectBad)

    await submit('192.168.0.16')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(FLASH_COPY.connectUnreachable)
    expect(readKnownDevice()).toBeNull()
    await click(button(FLASH_COPY.keepAddress))
    expect(readKnownDevice()).toMatchObject({ url: 'http://192.168.0.16/' })
    expect(wifiButton()?.getAttribute('aria-disabled')).toBeNull()
  })

  it('reads the screen log over Wi-Fi after a Wi-Fi send, and checks the picture from it', async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    let sent: { crc32: number; length: number } | null = null
    const chunks = (since: number) => {
      const text = sent
        ? [
            'I (12021) media: GIF 170x302 at (0,9)',
            `I (12021) media: JPEG, ${sent.length} bytes, CRC 0x${sent.crc32.toString(16).padStart(8, '0')} OK`,
            'I (12131) media: drew JPEG 170x320 at (0,0)',
            '',
          ].join('\r\n')
        : ''
      return since === 0 ? { text, start: 0, next: text.length } : { text: '', start: since, next: since }
    }
    setFlashDriver(
      fakeDriver({
        sendInPage: async (_device, image) => {
          const header = readMediaHeader(image)!
          sent = { crc32: header.crc32, length: header.length }
        },
        readLog: async (_device, since) => chunks(since),
      }),
    )
    const container = await mount()
    await upload(container)
    await click(wifiButton())
    await settle(60)

    expect(document.querySelector('.serial')?.textContent).toContain(`${FLASH_COPY.serialReadingWifi} ${URLS[0]}`)
    await click(document.querySelector('input[name="serial-view"][value="all"]'))
    expect(document.querySelector('.serial__log')?.textContent).toContain('media: JPEG')
    const checks = [...document.querySelectorAll('.serial__check')].map((item) => item.textContent).join(' ')
    expect(checks).toContain('Picture matches what this site sent')

    await click(button(FLASH_COPY.serialStop))
    expect(button(FLASH_COPY.serialWatchWifi)).toBeTruthy()
  })

  it('says when lines were missed, and stops after misses in a row', async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    let calls = 0
    setFlashDriver(
      fakeDriver({
        readLog: async (_device, since) => {
          calls++
          if (calls === 1) return { text: 'I (1) network: on Wi-Fi at http://192.168.0.16/ (also http://esper-49f5c0.local/)\r\n', start: 0, next: 100 }
          if (calls === 2) return { text: 'I (9) setup: hotspot off\r\n', start: since + 500, next: since + 530 }
          throw new WifiError('unreachable')
        },
      }),
    )
    await mount()
    await click(button(FLASH_COPY.serialWatchWifi))
    await settle(1200)
    expect(document.querySelector('.serial__log')?.textContent).toContain('[note] Some lines were missed')
    await settle(3500)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(FLASH_COPY.serialWifiFailed)
  }, 10000)
})
