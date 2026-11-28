// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { listDesigns } from './text/designsDb.ts'
import { keepDraft } from './text/draft.ts'

let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  globalThis.indexedDB = new IDBFactory()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('confirm', () => true)
  window.history.replaceState(null, '', '/text')
  keepDraft(null)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<App />)
  })
  await settle()
  return container
}

function button(container: ParentNode, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button "${name}"`)
  return found
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
  await settle()
}

/** Types into a React-controlled field. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!
  await act(async () => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

function layerNames(container: ParentNode) {
  return [...container.querySelectorAll('.layers__name')].map((item) => item.textContent)
}

describe('navbar', () => {
  it('moves between the Pictures and Text pages and marks where you are', async () => {
    const container = await mount()
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.site-nav a')]
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Pictures', '/'],
      ['Text', '/text'],
    ])
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Text')
    expect(container.textContent).toContain('My designs')

    await click(links[0]!)
    expect(window.location.pathname).toBe('/')
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Pictures')
    expect(container.textContent).toContain('See how pictures and examples will look on your screen.')
    expect(container.textContent).not.toContain('My designs')

    await act(async () => {
      window.history.back()
    })
    await settle()
    expect(window.location.pathname).toBe('/text')
    expect(container.textContent).toContain('My designs')
  })
})

describe('Text page', () => {
  it('starts with an LED scroller and edits its words, look and movement', async () => {
    const container = await mount()
    expect(layerNames(container)).toEqual(['WELCOME'])
    expect(container.querySelector('.layers__detail')?.textContent).toBe('LED text, scrolling left')

    await type(container.querySelector('textarea')!, 'DOORS OPEN')
    expect(layerNames(container)).toEqual(['DOORS OPEN'])

    const neon = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((input) => input.value === 'neon')!
    await click(neon)
    const still = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((input) => input.value === 'none')!
    await click(still)
    expect(container.querySelector('.layers__detail')?.textContent).toBe('Neon text, still')
    // Speed only matters for moving text.
    expect(container.textContent).not.toContain('px/s')
  })

  it('adds, copies, reorders and removes layers', async () => {
    const container = await mount()
    await click(button(container, '+ Text'))
    expect(layerNames(container)).toEqual(['Your text', 'WELCOME'])
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Copy Your text"]')!)
    expect(layerNames(container)).toHaveLength(3)
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Bring WELCOME forward"]')!)
    expect(layerNames(container)[1]).toBe('WELCOME')
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Delete WELCOME"]')!)
    expect(layerNames(container)).toEqual(['Your text', 'Your text'])
  })

  it('saves designs in this browser and opens them again to change', async () => {
    const container = await mount()
    expect(container.textContent).toContain('Changes not saved yet.')
    await type(container.querySelector<HTMLInputElement>('#design-name')!, 'Bar sign')
    await click(button(container, 'Save design'))
    expect(container.textContent).toContain('Saved “Bar sign”.')
    expect(container.textContent).toContain('All changes saved.')
    expect((await listDesigns()).map((design) => design.name)).toEqual(['Bar sign'])
    expect(container.querySelector('.design-library__name')?.textContent).toBe('Bar sign')

    await click(button(container, 'New design'))
    expect(container.querySelector<HTMLInputElement>('#design-name')!.value).toBe('My sign')
    await type(container.querySelector('textarea')!, 'Something else')

    await click(container.querySelector<HTMLButtonElement>('.design-library__open')!)
    expect(container.querySelector<HTMLInputElement>('#design-name')!.value).toBe('Bar sign')
    expect(layerNames(container)).toEqual(['WELCOME'])
    expect(container.textContent).toContain('Opened “Bar sign”.')

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Delete Bar sign"]')!)
    expect(await listDesigns()).toEqual([])
  })

  it('keeps layers on the design when the screen is turned upright', async () => {
    const container = await mount()
    const upright = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((input) => input.value === '0')!
    await click(upright)
    const fields = Object.fromEntries(
      [...container.querySelectorAll<HTMLInputElement>('.field-grid input')].map((input) => [input.id && container.querySelector(`label[for="${input.id}"]`)?.textContent, Number(input.value)]),
    )
    // It ran across the sideways screen, so it runs across the upright one.
    expect(fields).toMatchObject({ Left: 0, Width: 170 })
    expect(fields.Top! + fields.Height!).toBeLessThanOrEqual(320)
  })

  it("won't let a layer's box leave the screen, typed or dragged", async () => {
    const container = await mount()
    const field = (label: string) => {
      const id = [...container.querySelectorAll('label')].find((item) => item.textContent === label)!.getAttribute('for')!
      return container.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`)!
    }
    await type(field('Left'), '-50')
    expect(field('Left').value).toBe('0')
    await type(field('Width'), '1000')
    expect(field('Width').value).toBe('320')
    await type(field('Top'), '500')
    expect(Number(field('Top').value) + Number(field('Height').value)).toBe(170)
  })

  it('sets how bright the screen is for this design', async () => {
    const container = await mount()
    const slider = container.querySelector<HTMLInputElement>('input[type="range"][max="100"][min="10"]')!
    await type(slider, '40')
    expect(container.querySelector<HTMLCanvasElement>('.design-preview__canvas')!.style.filter).toBe('brightness(0.4)')
  })

  it("won't send until there's something to show", async () => {
    const container = await mount()
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Delete WELCOME"]')!)
    expect(container.textContent).toContain('Add some text or a picture first.')
  })
})
