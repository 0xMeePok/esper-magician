// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import type { ItemStatus } from './flash/onScreen.ts'
import MyUploadsSection from './components/MyUploadsSection.tsx'
import { QUOTA_MESSAGE, UNAVAILABLE_MESSAGE, type UploadTile } from './uploadList.ts'

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 8
  naturalHeight = 8
  #src = ''

  set src(value: string) {
    this.#src = value
    queueMicrotask(() => this.onload?.())
  }

  get src() {
    return this.#src
  }
}

function tile(id: string, name: string, animated = false): UploadTile {
  return { id, name, type: animated ? 'image/gif' : 'image/png', src: `/${name}`, animated }
}

let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  globalThis.indexedDB = new IDBFactory()
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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
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

function labels(container: ParentNode) {
  return [...container.querySelectorAll('.upload-tile')].map((button) => button.getAttribute('aria-label'))
}

async function storedNames(): Promise<string[]> {
  const open = indexedDB.open('esper-magician')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const names = await new Promise<string[]>((resolve, reject) => {
    const request = db.transaction('uploads').objectStore('uploads').getAll()
    request.onsuccess = () => {
      const rows = request.result as Array<{ name?: string }>
      resolve(rows.map((row) => row.name ?? '').sort())
    }
    request.onerror = () => reject(request.error)
  })
  db.close()
  return names
}

describe('My uploads section', () => {
  async function renderSection(overrides: Partial<Parameters<typeof MyUploadsSection>[0]> = {}) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const props = {
      // Nothing has been sent in these tests, so the picked tile reads "Selected".
      statusFor: (id: string): ItemStatus => (id === (overrides.selectedId ?? null) ? 'selected' : null),
      phase: 'ready' as const,
      tiles: [] as UploadTile[],
      selectedId: null,
      saveError: null,
      announcement: '',
      announcementNonce: 0,
      onOpenPicker: vi.fn(),
      onSelect: vi.fn(),
      onDelete: vi.fn(async () => {}),
      ...overrides,
    }

    await act(async () => {
      root?.render(<MyUploadsSection {...props} />)
    })
    return { container, props }
  }

  it('shows three skeletons and does not flash the empty promise', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html.match(/upload-skeleton/g)).toHaveLength(3)
    expect(html).not.toContain('No uploads yet.')
    expect(html).toContain('My uploads')
    expect(html).toContain('Saved on this device only. Clearing your browser data removes them.')
  })

  it('offers the same upload action from the empty library', async () => {
    const { container, props } = await renderSection()
    expect(container.textContent).toContain('No uploads yet.')
    expect(container.textContent).toContain('Pictures and GIFs you upload will be saved here.')
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Upload a picture or animation',
    )
    button?.click()
    expect(props.onOpenPicker).toHaveBeenCalledOnce()
  })

  it('drops the save promise when storage is unavailable and shows a quota error above the grid', async () => {
    const unavailable = await renderSection({ phase: 'unavailable' })
    expect(unavailable.container.textContent).toContain(UNAVAILABLE_MESSAGE)
    expect(unavailable.container.textContent).not.toContain(
      'Pictures and GIFs you upload will be saved here.',
    )
    await act(async () => root?.unmount())
    root = null

    const { container } = await renderSection({
      tiles: [tile('1', 'kept.png')],
      saveError: QUOTA_MESSAGE,
    })
    expect(container.textContent).toContain(QUOTA_MESSAGE)
    expect(labels(container)).toEqual(['kept.png, picture'])
  })

  it('renders a still GIF tile, a selected name, and a scroll cap after 12 items', async () => {
    const gif = await renderSection({
      tiles: [tile('g', 'cat.gif', true), tile('p', 'sunset.jpg')],
      selectedId: 'p',
    })
    const gifItem = gif.container.querySelector('.upload-item')
    expect(gifItem?.querySelector('canvas')).toBeTruthy()
    expect(gifItem?.querySelector('img')).toBeNull()
    expect(gifItem?.textContent).toContain('GIF')
    expect(gif.container.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe(
      'sunset.jpg, picture, Selected',
    )
    expect(gif.container.textContent).toContain('Selected')
    expect(gif.container.textContent).not.toContain('On the screen')
    await act(async () => root?.unmount())
    root = null

    const dozen = Array.from({ length: 12 }, (_, index) => tile(String(index), `f${index}.png`))
    const capped = await renderSection({ tiles: dozen })
    expect(capped.container.querySelector('.upload-grid-scroll')).toBeNull()
    await act(async () => root?.unmount())
    root = null

    const extra = await renderSection({ tiles: [...dozen, tile('12', 'f12.png')] })
    expect(extra.container.querySelector('.upload-grid-scroll')).toBeTruthy()
  })

  it('moves with the arrows and confirms removal from the keyboard', async () => {
    const tiles = [tile('a', 'a.png'), tile('b', 'b.png'), tile('c', 'c.png'), tile('d', 'd.png')]
    const { container, props } = await renderSection({ tiles })
    const buttons = [...container.querySelectorAll('.upload-tile')] as HTMLButtonElement[]
    buttons[0]?.focus()
    await act(async () => {
      buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement).toBe(buttons[1])
    await act(async () => {
      buttons[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(document.activeElement).toBe(buttons[3])
    await act(async () => {
      buttons[3]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(buttons[3])
    await act(async () => {
      buttons[3]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement?.textContent).toBe('Keep')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove d.png')

    const remove = container.querySelector('[aria-label="Remove d.png"]')
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('.upload-overlay')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const confirm = [...container.querySelectorAll('.upload-dialog button')].find(
      (button) => button.textContent === 'Remove',
    )
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(props.onDelete).toHaveBeenCalledWith('d')
  })
})

describe('saved uploads on the page', () => {
  it('saves JPEG, PNG, WebP, and GIF, restores them, and deletes one', async () => {
    const container = await mountApp()
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const click = vi.spyOn(input, 'click')
    const browse = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Upload a picture or animation',
    )
    expect(browse).toHaveLength(2)
    for (const button of browse) button.click()
    expect(click).toHaveBeenCalledTimes(2)

    await choose(container, new File([bytes], 'photo.png', { type: 'image/png' }))
    await choose(container, new File([bytes], 'photo.jpg', { type: 'image/jpeg' }))
    await choose(container, new File([bytes], 'photo.webp', { type: 'image/webp' }))
    await choose(container, new File([bytes], 'clip.gif', { type: 'image/gif' }))

    expect(labels(container)).toEqual([
      'clip.gif, animation, Selected',
      'photo.webp, picture',
      'photo.jpg, picture',
      'photo.png, picture',
    ])
    await settle()
    expect(container.querySelector('.upload-item canvas')).toBeTruthy()
    expect(container.querySelector('.upload-item img')).toBeTruthy()
    expect(container.textContent).toContain('Saved to My uploads')
    expect(container.querySelector('.viewport img')?.getAttribute('src')).toMatch(/^blob:/)
    expect(await storedNames()).toEqual(['clip.gif', 'photo.jpg', 'photo.png', 'photo.webp'])

    const saved = container.querySelector('[aria-label="photo.png, picture"]')
    await act(async () => {
      saved?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(container.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe(
      'photo.png, picture, Selected',
    )
    expect(container.querySelector('.viewport img')?.getAttribute('src')).toMatch(/^blob:/)

    const portrait = container.querySelector('input[value="1.9"]')
    await act(async () => {
      portrait?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('Your screen (170 × 320)')
    expect(container.querySelector('[aria-pressed="true"]')).toBeTruthy()
    expect(container.querySelector('.viewport')?.getAttribute('style')).toContain('width: 170px')
    expect(container.querySelector('.viewport')?.getAttribute('style')).toContain('height: 320px')

    const remove = container.querySelector('[aria-label="Remove photo.png"]')
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const confirm = [...container.querySelectorAll('.upload-dialog button')].find(
      (button) => button.textContent === 'Remove',
    )
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(labels(container)).toEqual([
      'clip.gif, animation',
      'photo.webp, picture',
      'photo.jpg, picture',
    ])
    expect(await storedNames()).toEqual(['clip.gif', 'photo.jpg', 'photo.webp'])
    await settle()
    expect(container.textContent).toContain('Removed')
    expect(container.textContent).toContain('Nothing on the screen yet.')
  })

  it('keeps the preview when saving exceeds the quota', async () => {
    const container = await mountApp()
    await choose(container, new File([bytes], 'kept.png', { type: 'image/png' }))
    const open = indexedDB.open('esper-magician')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const store = db.transaction('uploads', 'readonly').objectStore('uploads')
    vi.spyOn(Object.getPrototypeOf(store), 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    db.close()
    await choose(container, new File([bytes], 'new.png', { type: 'image/png' }))

    expect(container.textContent).toContain(QUOTA_MESSAGE)
    expect(labels(container)).toEqual(['kept.png, picture'])
    expect(container.querySelector('.viewport img')?.getAttribute('src')).toMatch(/^blob:/)
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull()
    expect(await storedNames()).toEqual(['kept.png'])
  })

  it('still previews a file when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const container = await mountApp()
    expect(container.textContent).toContain(UNAVAILABLE_MESSAGE)
    expect(container.textContent).not.toContain('Pictures and GIFs you upload will be saved here.')
    await choose(container, new File([bytes], 'photo.png', { type: 'image/png' }))
    expect(container.querySelector('.viewport img')?.getAttribute('src')).toMatch(/^blob:/)
    expect(container.querySelector('.upload-item')).toBeNull()
    expect(container.textContent).not.toContain('Saved to My uploads')
  })
})
