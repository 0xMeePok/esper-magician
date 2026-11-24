// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { setCompressor, type CompressJob, type Compressor } from './compress/client.ts'
import { COMPRESSION_COPY } from './compress/copy.ts'
import type { EncodedResult } from './compress/gif.ts'
import { useCompression } from './compress/useCompression.ts'
import { EDITOR_COPY } from './cropCopy.ts'
import { mediaBudget } from './flashLayout.ts'
import { useScreenContent } from './useScreenContent.ts'

const BUDGET = mediaBudget('2.8')

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 1600
  naturalHeight = 900
  #src = ''

  set src(value: string) {
    this.#src = value
    queueMicrotask(() => this.onload?.())
  }

  get src() {
    return this.#src
  }
}

let root: Root | null = null
let idb: IDBFactory
let jobs: CompressJob[]

/** A compressor whose result sizes are set per test. */
function fakeCompressor(sizes: [number, number, number], fail = false): Compressor {
  return async (job) => {
    jobs.push(job)
    job.onProgress?.(0.5)
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (fail) throw new Error('broken')
    return (['light', 'balanced', 'strong'] as const).map(
      (strength, index): EncodedResult => ({
        strength,
        bytes: new Uint8Array(sizes[index]!).fill(index + 1),
        width: job.screen.width,
        height: job.screen.height,
        frames: 1,
      }),
    )
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  idb = new IDBFactory()
  globalThis.indexedDB = idb
  localStorage.clear()
  jobs = []
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  setCompressor()
  vi.unstubAllGlobals()
})

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mount(node = <App />) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(node)
  })
  await settle()
  return container
}

function bigFile(bytes: number, name = 'huge.png', type = 'image/png') {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function choose(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
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

function panel() {
  return document.querySelector('section.compression')
}

function radio(strength: string) {
  return document.querySelector<HTMLInputElement>(`.compression input[value="${strength}"]`)
}

function screenImage() {
  return document.querySelector('.page .viewport img')?.getAttribute('src') ?? null
}

describe('compression panel (ASH-34)', () => {
  it('only appears when the upload is bigger than the space on the device', async () => {
    setCompressor(fakeCompressor([10, 9, 8]))
    const container = await mount()
    await choose(container, bigFile(BUDGET, 'fits.png'))
    expect(panel()).toBeNull()
    expect(jobs).toHaveLength(0)

    await choose(container, bigFile(BUDGET + 1, 'over.png'))
    expect(panel()?.querySelector('h2')?.textContent).toBe(COMPRESSION_COPY.heading)
    expect(panel()?.textContent).toContain('Your screen has room for 3.56 MB. Pick how much to shrink it.')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.screen).toEqual({ width: 320, height: 240 })
    expect(jobs[0]?.crop).toBeNull()
  })

  it('shows sizes, grays out strengths that still do not fit, and picks the lightest that fits', async () => {
    setCompressor(fakeCompressor([4_000_000, 2_400_000, 1_200_000]))
    const container = await mount()
    await choose(container, bigFile(8_000_000))
    const original = jobs[0]

    expect(radio('light')?.disabled).toBe(true)
    expect(radio('light')?.closest('label')?.textContent).toContain('Still too big (3.81 MB)')
    expect(radio('balanced')?.disabled).toBe(false)
    expect(radio('strong')?.disabled).toBe(false)
    expect(radio('strong')?.closest('label')?.textContent).toContain('1.14 MB')
    expect(radio('balanced')?.checked).toBe(true)
    expect(panel()?.textContent).toContain('Compressed (Balanced) · 2.29 MB of 3.56 MB')
    expect(original?.file.size).toBe(8_000_000)
  })

  it('says it cannot be done when even strong is too big', async () => {
    setCompressor(fakeCompressor([6_000_000, 5_000_000, 4_000_000]))
    const container = await mount()
    await choose(container, bigFile(10_000_000))
    expect(panel()?.querySelector('[role="alert"]')?.textContent).toBe(COMPRESSION_COPY.noneFit)
    expect(panel()?.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(panel()?.textContent).not.toContain('Pick how much to shrink it.')
  })

  it('shows progress while working and a plain message if it fails', async () => {
    setCompressor(fakeCompressor([1, 1, 1], true))
    const container = await mount()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [bigFile(BUDGET + 10)] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 2))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })
    const bar = panel()?.querySelector('[role="progressbar"]')
    if (bar) expect(['0', '50']).toContain(bar.getAttribute('aria-valuenow'))
    await settle(80)
    expect(panel()?.querySelector('[role="alert"]')?.textContent).toBe(COMPRESSION_COPY.failed)
  })
})

describe('compressed preview (ASH-35)', () => {
  it('previews the chosen strength, compares with the original, and saves the choice', async () => {
    setCompressor(fakeCompressor([3_000_000, 1_800_000, 800_000]))
    const container = await mount()
    await choose(container, bigFile(6_000_000))
    const balancedOrLight = screenImage()
    expect(radio('light')?.checked).toBe(true)
    expect(balancedOrLight).toMatch(/^blob:/)

    await click(radio('strong'))
    const strong = screenImage()
    expect(radio('strong')?.checked).toBe(true)
    expect(strong).not.toBe(balancedOrLight)
    expect(panel()?.textContent).toContain('Compressed (Strong) · 781 KB of 3.56 MB')

    const toggle = [...(panel()?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === COMPRESSION_COPY.showOriginal,
    )
    await click(toggle)
    const original = screenImage()
    expect(original).not.toBe(strong)
    expect(panel()?.querySelector('button[aria-pressed="true"]')?.textContent).toBe(
      COMPRESSION_COPY.showCompressed,
    )
    await click(panel()?.querySelector('button[aria-pressed="true"]'))
    expect(screenImage()).toBe(strong)
    expect(jobs).toHaveLength(1)

    // Saved with the upload so it survives a reload (ASH-35).
    const open = idb.open('esper-magician')
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result)
    })
    const rows = await new Promise<Array<{ compressed?: Record<string, { strength: string; cropKey: string }> }>>(
      (resolve) => {
        const request = db.transaction('uploads').objectStore('uploads').getAll()
        request.onsuccess = () => resolve(request.result)
      },
    )
    db.close()
    expect(rows[0]?.compressed?.['2.8']).toMatchObject({ strength: 'strong', cropKey: 'none' })
  })

  it('recompresses after a new crop and keeps a separate choice per screen', async () => {
    setCompressor(fakeCompressor([3_000_000, 1_800_000, 800_000]))
    const container = await mount()
    await choose(container, bigFile(6_000_000))
    await click(radio('balanced'))

    await click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Crop'))
    await click([...document.querySelectorAll('.crop-dialog button')].find((button) => button.textContent === EDITOR_COPY.apply))
    await settle(60)
    expect(jobs).toHaveLength(2)
    expect(jobs[1]?.crop).not.toBeNull()
    expect(radio('balanced')?.checked).toBe(true)

    await click(container.querySelector('input[value="1.9"]'))
    await settle(60)
    expect(jobs).toHaveLength(3)
    expect(jobs[2]?.screen).toEqual({ width: 170, height: 320 })
    expect(radio('light')?.checked).toBe(true)

    await click(container.querySelector('input[value="2.8"]'))
    expect(radio('balanced')?.checked).toBe(true)
    expect(jobs).toHaveLength(3)
  })

  it('assetFor hands the flasher exactly the previewed bytes, or the original when it fits', async () => {
    setCompressor(fakeCompressor([3_000_000, 1_800_000, 800_000]))
    let api: { content: ReturnType<typeof useScreenContent>; compression: ReturnType<typeof useCompression> } | null =
      null
    function Harness() {
      const content = useScreenContent()
      const compression = useCompression(content.current, '2.8', content.chooseCompression)
      useEffect(() => {
        api = { content, compression }
      })
      return null
    }
    await mount(<Harness />)
    await act(async () => {
      await api!.content.openFile(bigFile(BUDGET))
    })
    await settle(60)
    const fits = api!.content.assetFor('2.8')
    expect(fits).toMatchObject({ kind: 'upload', compressed: null, type: 'image/png' })
    expect(fits?.kind === 'upload' && fits.blob.size).toBe(BUDGET)

    await act(async () => {
      await api!.content.openFile(bigFile(BUDGET * 2))
    })
    await settle(80)
    const asset = api!.content.assetFor('2.8')
    expect(asset).toMatchObject({ kind: 'upload', compressed: 'light', type: 'image/jpeg' })
    expect(asset?.kind === 'upload' && asset.blob.size).toBe(3_000_000)

    await act(async () => api!.compression.select('strong'))
    await settle()
    const strong = api!.content.assetFor('2.8')
    expect(strong?.kind === 'upload' && strong.blob.size).toBe(800_000)
    // The 1.9-inch screen has no compressed copy yet, so there is nothing safe to flash there.
    expect(api!.content.assetFor('1.9')).toBeNull()
  })
})
