// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
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
}

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
    loadFirmware: async () => ({
      manifest: { name: 'ESPER player', version: '1.0.0', chip: 'ESP32', mediaOffset: 0xf0000, parts: [] },
      parts: [
        { data: new Uint8Array(10), address: 0x1000 },
        { data: new Uint8Array(3), address: 0x8000 },
        { data: new Uint8Array(20), address: 0x10000 },
      ],
    }),
    prepareDeviceAsset: async (source, screen, budget) => {
      record('prepare', source, screen, budget)
      return { kind: 'jpeg', bytes: JPEG, strength: 'light' }
    },
    writeOverUsb:
      fakes.write ??
      (async (port, parts, onProgress) => {
        record('write', port, parts)
        onProgress(0.5)
        await new Promise((resolve) => setTimeout(resolve, 5))
        onProgress(1)
      }),
    openImprov: async (port) => {
      record('openImprov', port)
      return {
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
  calls = {}
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

function flashButton() {
  return [...document.querySelectorAll('button')].find((button) => button.textContent === FLASH_COPY.button)
}

function flashText() {
  return document.querySelector('section.flash')?.textContent ?? ''
}

describe('put it on my screen (ASH-19)', () => {
  it('waits for something to send, and never offers the clock', async () => {
    setFlashDriver(fakeDriver())
    const container = await mount()
    expect(flashButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.nothing)

    const clock = [...container.querySelectorAll('[role="radio"]')].find((row) => row.textContent?.includes('Digital clock'))
    await click(clock)
    await settle()
    expect(flashButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.clock)
    await click(flashButton())
    expect(calls.choosePort).toBeUndefined()
  })

  it('installs over USB the first time, sets up Wi-Fi, and remembers the screen', async () => {
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    expect(flashButton()?.getAttribute('aria-disabled')).toBeNull()
    expect(flashText()).toContain(FLASH_COPY.helperUsb)

    await click(flashButton())
    await settle(60)
    expect(calls.choosePort).toHaveLength(1)

    // The upload fits, so it is made for the screen with its crop (none here).
    const [source, screen] = calls.prepare![0]!
    expect(source).toMatchObject({ kind: 'convert', animated: false, crop: null })
    expect(screen).toMatchObject({ width: 170, height: 320 })

    // Bootloader, partition table, player, then the picture at the media partition.
    const [, parts] = calls.write![0]! as [SerialPort, Array<{ data: Uint8Array; address: number }>]
    expect(parts.map((part) => part.address)).toEqual([0x1000, 0x8000, 0x10000, 0xf0000])
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
  })

  it('sends over Wi-Fi once the screen is known, with no device list', async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: URLS[1], savedAt: 1 }))
    setFlashDriver(fakeDriver())
    const container = await mount()
    await upload(container)
    expect(flashText()).toContain(FLASH_COPY.helperWifi)
    await click(flashButton())
    await settle()
    expect(calls.choosePort).toBeUndefined()
    expect(calls.openWindow).toHaveLength(1)
    const [device, image] = calls.sendOverWifi![0]! as [unknown, Uint8Array]
    expect(device).toMatchObject({ url: URLS[0] })
    expect(readMediaHeader(image)).toMatchObject({ kind: 'jpeg', length: JPEG.length })
    expect(flashText()).toContain(FLASH_COPY.done)
    expect(flashText()).toContain(FLASH_COPY.doneWifi)
  })

  it('offers USB when the screen cannot be reached over Wi-Fi', async () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    setFlashDriver(
      fakeDriver({
        waitForPlayer: async () => URLS,
        sendOverWifi: async () => {
          throw new WifiError('unreachable')
        },
      }),
    )
    const container = await mount()
    await upload(container)
    await click(flashButton())
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Couldn't reach your screen over Wi-Fi/)
    expect(calls.closeWindow).toHaveLength(1)

    const useUsb = [...document.querySelectorAll('.flash__status button')].find(
      (button) => button.textContent === FLASH_COPY.useUsb,
    )
    await click(useUsb)
    await settle(60)
    expect(calls.choosePort).toHaveLength(1)
    expect(calls.write).toHaveLength(1)
    // The player was already on the Wi-Fi: no form, and its address is refreshed.
    expect(document.querySelector('form.flash__wifi')).toBeNull()
    expect(flashText()).toContain(FLASH_COPY.doneWifi)
  })

  it('says plainly what went wrong over USB, and goes quiet if the device list is closed', async () => {
    setFlashDriver(fakeDriver({ port: null }))
    const container = await mount()
    await upload(container)
    await click(flashButton())
    await settle()
    expect(calls.prepare).toBeUndefined()
    expect(document.querySelector('[role="alert"]')).toBeNull()

    setFlashDriver(
      fakeDriver({
        write: async () => {
          throw new UsbError('busy')
        },
      }),
    )
    await click(flashButton())
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Another app is using/)
  })

  it('needs Chrome or Edge for the first set-up only', async () => {
    setFlashDriver(fakeDriver({ usb: false }))
    const container = await mount()
    await upload(container)
    expect(flashButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(flashText()).toContain(FLASH_COPY.needsChrome)

    act(() => root?.unmount())
    root = null
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ url: URLS[0], localUrl: null, savedAt: 1 }))
    const again = await mount()
    await upload(again)
    expect(flashButton()?.getAttribute('aria-disabled')).toBeNull()
    expect(flashText()).not.toContain(FLASH_COPY.useUsb)
  })
})
