// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import CropEditor from './components/CropEditor.tsx'
import { CROP_DISABLED_HELPER, CROPPED_CAPTION, EDITOR_COPY } from './cropCopy.ts'
import { screenFor } from './screens.ts'

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

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

beforeEach(() => {
  document.body.innerHTML = ''
  idb = new IDBFactory()
  globalThis.indexedDB = idb
  localStorage.clear()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mountApp() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<App />)
  })
  await settle()
  return container
}

async function choose(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('missing element')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

async function key(target: Element | null | undefined, value: string, init: KeyboardEventInit = {}) {
  if (!target) throw new Error('missing element')
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...init }))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

function cropButton() {
  return [...document.querySelectorAll('button')].find((button) => button.textContent === 'Crop')
}

function buttonNamed(name: string, root: ParentNode = document) {
  return [...root.querySelectorAll('button')].find(
    (button) => button.textContent === name || button.getAttribute('aria-label') === name,
  )
}

function dialog() {
  return document.querySelector('[role="dialog"].crop-dialog')
}

function pageViewport() {
  return document.querySelector('.page .viewport')
}

async function storedCrops(): Promise<unknown[]> {
  const open = idb.open('esper-magician')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const rows = await new Promise<Array<{ crops?: unknown }>>((resolve, reject) => {
    const request = db.transaction('uploads').objectStore('uploads').getAll()
    request.onsuccess = () => resolve(request.result as Array<{ crops?: unknown }>)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return rows.map((row) => row.crops ?? null)
}

describe('Crop button (ASH-29)', () => {
  it('stays visible but disabled until your own picture is on the screen', async () => {
    const container = await mountApp()
    const button = cropButton()
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    const helperId = button?.getAttribute('aria-describedby')
    expect(helperId && document.getElementById(helperId)?.textContent).toBe(CROP_DISABLED_HELPER)
    await click(button)
    expect(dialog()).toBeNull()

    const photoFrame = [...container.querySelectorAll('[role="radio"]')].find((node) =>
      node.textContent?.includes('Photo frame'),
    )
    await click(photoFrame)
    await settle()
    expect(cropButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(container.textContent).toContain(CROP_DISABLED_HELPER)

    await choose(container, new File([bytes], 'beach.png', { type: 'image/png' }))
    expect(cropButton()?.hasAttribute('aria-disabled')).toBe(false)
    expect(container.textContent).not.toContain(CROP_DISABLED_HELPER)
    expect(container.textContent).not.toContain(CROPPED_CAPTION)
    expect(pageViewport()?.getAttribute('data-framing')).toBe('contain')
  })
})

describe('crop editor (ASH-29)', () => {
  it('rotates, crops, previews, applies, and persists with the saved upload', async () => {
    const container = await mountApp()
    await choose(container, new File([bytes], 'beach.png', { type: 'image/png' }))

    await click(cropButton())
    const editor = dialog()
    expect(editor?.getAttribute('aria-modal')).toBe('true')
    const title = editor?.querySelector('h2')
    expect(title?.textContent).toBe('Crop for 1.9-inch screen')
    expect(editor?.getAttribute('aria-labelledby')).toBe(title?.id)
    expect(document.activeElement).toBe(title)
    expect(editor?.textContent).toContain('Shape locked to your screen (170 × 320)')
    expect(document.querySelector('.page')?.hasAttribute('inert')).toBe(true)
    expect(editor?.textContent).not.toContain(EDITOR_COPY.gifCaption)

    const preview = editor?.querySelector('.crop-dialog__preview .viewport')
    expect(preview?.getAttribute('style')).toContain('width: 170px')
    expect(preview?.getAttribute('data-framing')).toBe('cropped')

    await click(buttonNamed(EDITOR_COPY.rotateRightLabel, editor!))
    expect(editor?.textContent).toContain('Rotated to 90 degrees.')
    expect(editor?.textContent).toContain('Rotated 90°')
    expect(editor?.querySelector('.viewport__cropped')?.getAttribute('style')).toContain(
      'rotate(90deg)',
    )

    const area = editor?.querySelector('[aria-roledescription="adjustable crop area"]')
    expect(area?.getAttribute('aria-label')).toBe('Crop area')
    expect(area?.getAttribute('tabindex')).toBe('0')
    await key(area, '-')
    expect(editor?.textContent).toMatch(/Crop area \d+ by \d+, centered/)
    await key(area, 'ArrowUp', { shiftKey: true })
    expect(editor?.textContent).toMatch(/Crop area \d+ by \d+/)

    await click(buttonNamed(EDITOR_COPY.apply, editor!))
    expect(dialog()).toBeNull()
    expect(document.querySelector('.page')?.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(cropButton())
    expect(pageViewport()?.getAttribute('data-framing')).toBe('cropped')
    expect(pageViewport()?.querySelector('.viewport__cropped')?.getAttribute('style')).toContain(
      'rotate(90deg)',
    )
    expect(container.textContent).toContain(CROPPED_CAPTION)
    expect(container.textContent).toContain('Crop applied for the 1.9-inch screen.')
    await settle()
    const [saved] = (await storedCrops()) as Array<Record<string, { rotationDeg: number }>>
    expect(saved?.['1.9']?.rotationDeg).toBe(90)

    // Cancel (Esc) changes nothing.
    await click(cropButton())
    await click(buttonNamed(EDITOR_COPY.rotateLeftLabel, dialog()!))
    await key(dialog(), 'Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(cropButton())
    expect(pageViewport()?.getAttribute('data-framing')).toBe('cropped')
    expect(pageViewport()?.querySelector('.viewport__cropped')?.getAttribute('style')).toContain(
      'rotate(90deg)',
    )
    expect(container.textContent).toContain(CROPPED_CAPTION)

    // Another upload starts uncropped; picking the saved one brings its crop back.
    await choose(container, new File([bytes], 'other.png', { type: 'image/png' }))
    expect(pageViewport()?.getAttribute('data-framing')).toBe('contain')
    expect(container.textContent).not.toContain(CROPPED_CAPTION)
    await click(container.querySelector('[aria-label="beach.png, picture"]'))
    await settle()
    expect(pageViewport()?.getAttribute('data-framing')).toBe('cropped')
    expect(container.textContent).toContain(CROPPED_CAPTION)
    const again = container

    // Reset to original + Apply removes the crop for this screen.
    await click(cropButton())
    await click(buttonNamed(EDITOR_COPY.reset, dialog()!))
    expect(dialog()?.querySelector('.crop-dialog__preview .viewport')?.getAttribute('data-framing')).toBe(
      'contain',
    )
    await click(buttonNamed(EDITOR_COPY.apply, dialog()!))
    expect(pageViewport()?.getAttribute('data-framing')).toBe('contain')
    expect(again.textContent).not.toContain(CROPPED_CAPTION)
    expect(again.textContent).toContain('Crop removed for the 1.9-inch screen.')
    await settle()
    const remaining = await storedCrops()
    expect(remaining).toHaveLength(2)
    expect(remaining.every((crops) => crops === null || Object.keys(crops as object).length === 0)).toBe(true)
  })

  it('Cancel leaves the display unchanged and keeps focus inside while open', async () => {
    const container = await mountApp()
    await choose(container, new File([bytes], 'beach.png', { type: 'image/png' }))
    await click(cropButton())
    const editor = dialog()!

    const apply = buttonNamed(EDITOR_COPY.apply, editor)!
    apply.focus()
    await key(apply, 'Tab')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Crop area')
    await key(document.activeElement, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(apply)

    await click(buttonNamed(EDITOR_COPY.rotateRightLabel, editor))
    await click(buttonNamed(EDITOR_COPY.cancel, editor))
    expect(dialog()).toBeNull()
    expect(pageViewport()?.getAttribute('data-framing')).toBe('contain')
    expect(container.textContent).not.toContain(CROPPED_CAPTION)
  })

  it('crops a GIF from its first frame and keeps it animated after Apply', async () => {
    const container = await mountApp()
    await choose(container, new File([bytes], 'loop.gif', { type: 'image/gif' }))
    await click(cropButton())
    expect(dialog()?.textContent).toContain(EDITOR_COPY.gifCaption)
    await click(buttonNamed(EDITOR_COPY.apply, dialog()!))
    const image = pageViewport()?.querySelector('img.viewport__cropped')
    expect(image?.getAttribute('src')).toMatch(/^blob:/)
    expect(pageViewport()?.querySelector('canvas')).toBeNull()
  })

  it('shows the decode error and only lets you cancel', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onApply = vi.fn()
    const onCancel = vi.fn()
    await act(async () => {
      root?.render(
        <CropEditor
          screen={screenFor('1.9')}
          media={{ url: 'blob:broken', name: 'x.png', animated: false, source: { width: 10, height: 10 } }}
          saved={null}
          decoded={false}
          onApply={onApply}
          onCancel={onCancel}
        />,
      )
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(EDITOR_COPY.decodeError)
    for (const name of [
      EDITOR_COPY.rotateLeftLabel,
      EDITOR_COPY.rotateRightLabel,
      EDITOR_COPY.reset,
      EDITOR_COPY.apply,
    ]) {
      expect(buttonNamed(name, container)?.disabled).toBe(true)
    }
    expect(buttonNamed(EDITOR_COPY.cancel, container)?.disabled).toBe(false)
    await click(buttonNamed(EDITOR_COPY.cancel, container))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('never sends the picture anywhere', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send')
    const container = await mountApp()
    await choose(container, new File([bytes], 'beach.png', { type: 'image/png' }))
    await click(cropButton())
    await click(buttonNamed(EDITOR_COPY.apply, dialog()!))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
