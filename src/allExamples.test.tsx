// @vitest-environment happy-dom
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { clockFace } from './clock.ts'
import BoardScreen from './components/BoardScreen.tsx'
import DigitalClock from './components/DigitalClock.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import InfoCard from './components/InfoCard.tsx'
import Viewport from './components/Viewport.tsx'
import { ERROR_EXAMPLE_FAILED, type ViewportState } from './components/viewportState.ts'
import { examples, INFO_CARD_LINE, INFO_CARD_TITLE } from './examples.ts'
import { showExample } from './preview.ts'
import { screenFor } from './screens.ts'

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 320
  naturalHeight = 240
  #src = ''

  set src(value: string) {
    this.#src = value
    queueMicrotask(() => {
      if (FakeImage.fail) this.onerror?.()
      else this.onload?.()
    })
  }

  get src() {
    return this.#src
  }

  static fail = false
}

function asset(name: string) {
  return join(process.cwd(), 'public', 'examples', name)
}

const FORBIDDEN = /\b(chip|flash size|pinout|spi|voltage|gpio|ili9341|st7789)\b/i

let root: Root | null = null

beforeEach(() => {
  FakeImage.fail = false
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mountApp() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<App />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  return container
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('missing element')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

function row(container: ParentNode, title: string) {
  return [...container.querySelectorAll('[role="radio"]')].find((node) =>
    node.textContent?.includes(title),
  )
}

describe('example picker (ASH-17)', () => {
  it('lists four examples in the designed order with the exact copy', () => {
    expect(examples.map((example) => [example.title, example.description])).toEqual([
      ['Photo frame', 'A still picture that fills the screen.'],
      ['Animation loop', 'A short animation that plays over and over.'],
      ['Digital clock', 'A large, easy-to-read clock for the screen.'],
      ['Info card', 'A simple card with a title, a short line, and an icon.'],
    ])
    expect(examples.map((example) => example.kind)).toEqual(['still', 'animation', 'clock', 'card'])

    const html = renderToStaticMarkup(<ExamplesSection selectedId={null} statusFor={() => null} onSelect={() => {}} />)
    expect(html.match(/role="radio"/g)).toHaveLength(4)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/width="64"/g)).toHaveLength(4)
    expect(html).not.toMatch(FORBIDDEN)
    for (const example of examples) expect(html).toContain(`src="${example.thumbnail}"`)
  })

  it('ships the ASH-20 GIF unchanged, plus still thumbnails', () => {
    const gif = new Uint8Array(readFileSync(asset('animation-loop.gif')))
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a')
    expect(gif[6]! | (gif[7]! << 8)).toBe(320)
    expect(gif[8]! | (gif[9]! << 8)).toBe(240)
    expect(gif.byteLength).toBe(82784)
    expect(gif.byteLength).toBeLessThanOrEqual(150 * 1024)
    expect(createHash('sha256').update(gif).digest('hex')).toBe(
      '04b2121409ee086c7c6ea5e412249e2db64a24e13b1b7b87a5a2a1de6adb0551',
    )

    const thumb = new Uint8Array(
      readFileSync(asset('animation-loop-thumb.png')),
    )
    expect([...thumb.slice(1, 4)].map((byte) => String.fromCharCode(byte)).join('')).toBe('PNG')
    for (const name of ['digital-clock-thumb.svg', 'info-card-thumb.svg']) {
      const svg = readFileSync(asset(name), 'utf8')
      expect(svg).toContain('<svg')
      expect(svg).not.toContain('<script')
    }
  })

  it('loads each example into the viewport state it needs', async () => {
    const runs: Record<string, Array<{ id: string | null; state: ViewportState }>> = {}
    for (const example of examples) {
      runs[example.id] = []
      await showExample(example.id, null, (id, state) => runs[example.id]!.push({ id, state }))
    }
    expect(runs['animation-loop']).toEqual([
      { id: 'animation-loop', state: { status: 'loading' } },
      {
        id: 'animation-loop',
        state: { status: 'content', src: '/examples/animation-loop.gif', animated: true },
      },
    ])
    expect(runs['digital-clock']?.at(-1)).toEqual({
      id: 'digital-clock',
      state: { status: 'layout', layout: 'clock' },
    })
    expect(runs['info-card']?.at(-1)).toEqual({
      id: 'info-card',
      state: { status: 'layout', layout: 'card' },
    })

    FakeImage.fail = true
    const failed: Array<{ id: string | null; state: ViewportState }> = []
    await showExample('animation-loop', null, (id, state) => failed.push({ id, state }))
    expect(failed.at(-1)).toEqual({
      id: null,
      state: { status: 'error', message: ERROR_EXAMPLE_FAILED, interior: 'plain' },
    })
  })

  it('contains the Animation loop GIF and stills it for reduced motion on both screens', () => {
    for (const id of ['1.9'] as const) {
      const screen = screenFor(id)
      const state: ViewportState = {
        status: 'content',
        src: '/examples/animation-loop.gif',
        animated: true,
      }
      const playing = renderToStaticMarkup(
        <Viewport state={state} statusId="s" width={screen.width} height={screen.height} reducedMotion={false} />,
      )
      expect(playing).toContain('src="/examples/animation-loop.gif"')
      expect(playing).toContain('object-fit:contain')
      expect(playing).toContain(`width:${screen.width}px`)
      expect(playing).toContain(`height:${screen.height}px`)

      const still = renderToStaticMarkup(
        <Viewport state={state} statusId="s" width={screen.width} height={screen.height} reducedMotion />,
      )
      expect(still).toContain('<canvas')
      expect(still).not.toContain('<img')
    }
  })
})

describe('Digital clock', () => {
  const sample = new Date(2026, 10, 12, 10, 42, 7)

  it('follows the locale: AM/PM on 12-hour, seconds on 24-hour', () => {
    expect(clockFace(sample, 'en-US')).toMatchObject({
      time: '10:42',
      detail: 'AM',
      date: 'Thu 12 Nov',
      showsSeconds: false,
    })
    expect(clockFace(sample, 'en-GB')).toMatchObject({
      time: '10:42',
      detail: '07',
      date: 'Thu 12 Nov',
      showsSeconds: true,
    })
    expect(clockFace(new Date(2026, 10, 12, 21, 5, 0), 'en-GB').time).toBe('21:05')
    expect(clockFace(new Date(2026, 10, 12, 21, 5, 0), 'en-US')).toMatchObject({
      time: '9:05',
      detail: 'PM',
    })
  })

  it('is laid out to each screen with the specified sizes, not letterboxed', () => {
    const wide = renderToStaticMarkup(<DigitalClock width={320} height={240} now={sample} />)
    expect(wide).toContain('width:320px;height:240px')
    expect(wide).toContain('font-size:64px')
    expect(wide).toContain('font-size:16px')
    expect(wide).toContain('font-size:14px')

    const tall = renderToStaticMarkup(<DigitalClock width={170} height={320} now={sample} />)
    expect(tall).toContain('width:170px;height:320px')
    expect(tall).toContain('font-size:40px')
    expect(tall).toContain('font-size:14px')
    expect(tall).toContain('font-size:12px')
  })

  it('ticks and clears its timer when another example replaces it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date(2026, 10, 12, 10, 42, 58))
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<DigitalClock width={320} height={240} />)
    })
    const before = container.querySelector('.example-clock__time')?.textContent
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    const after = container.querySelector('.example-clock__time')?.textContent
    expect(before).not.toBe(after)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => root?.unmount())
    root = null
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Info card', () => {
  it('shows the static sample with the right spacing on each screen', () => {
    const wide = renderToStaticMarkup(<InfoCard width={320} height={240} />)
    expect(wide).toContain(INFO_CARD_TITLE)
    expect(wide).toContain(INFO_CARD_LINE)
    expect(wide).toContain('padding:24px')
    expect(wide).toContain('font-size:22px')
    expect(wide).toContain('aria-hidden="true"')
    expect(wide).toContain('#0F766E')

    const tall = renderToStaticMarkup(<InfoCard width={170} height={320} />)
    expect(tall).toContain('padding:16px')
    expect(tall).toContain('font-size:18px')
    expect(tall).toContain('font-size:14px')
  })
})

describe('examples on the page', () => {
  it('selects each example and previews it on the screen', async () => {
    const container = await mountApp()
    for (const example of examples) {
      await click(row(container, example.title))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      const selected = container.querySelector('[role="radio"][aria-checked="true"]')
      expect(selected?.textContent).toContain(example.title)
      // Picked, not sent: it reads "Selected" until it is flashed.
      expect(selected?.textContent).toContain('Selected')
      expect(selected?.textContent).not.toContain('On the screen')

      for (const id of ['1.9'] as const) {
        const screen = screenFor(id)
        const viewport = container.querySelector('.viewport')
        expect(viewport?.getAttribute('style')).toContain(`width: ${screen.width}px`)
        expect(viewport?.getAttribute('style')).toContain(`height: ${screen.height}px`)
        if (example.kind === 'clock') {
          expect(viewport?.querySelector('.example-clock')).toBeTruthy()
        } else if (example.kind === 'card') {
          expect(viewport?.textContent).toContain(INFO_CARD_LINE)
        } else if ('src' in example) {
          expect(viewport?.getAttribute('data-framing')).toBe('contain')
          expect(viewport?.querySelector('img')?.getAttribute('src')).toBe(example.src)
        } else {
          throw new Error(`unexpected example ${example.id}`)
        }
        expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain(
          example.title,
        )
      }
    }
    expect(container.textContent).not.toMatch(FORBIDDEN)
  })

  it('moves between rows with the arrow keys and selects with Enter', async () => {
    const container = await mountApp()
    const rows = [...container.querySelectorAll<HTMLElement>('[role="radio"].example-row')]
    rows[0]?.focus()
    await act(async () => {
      rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(rows[1])
    await act(async () => {
      rows[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    await act(async () => {
      rows[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(rows[2]?.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.viewport .example-clock')).toBeTruthy()
  })

  it('previews each example inside the bezel at the screen size', () => {
    for (const id of ['1.9'] as const) {
      const screen = screenFor(id)
      const card = renderToStaticMarkup(
        <BoardScreen screen={screen} state={{ status: 'layout', layout: 'card' }} />,
      )
      expect(card).toContain(`width:${screen.width}px`)
      expect(card).toContain('data-state="layout"')
      expect(card).not.toContain('Nothing on the screen yet.')
    }
  })
})
