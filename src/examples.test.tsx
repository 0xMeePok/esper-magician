import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import BoardScreen from './components/BoardScreen.tsx'
import pageCss from './index.css?inline'
import { examples, nextExampleIndex, ON_THE_SCREEN } from './examples.ts'
import { keepsCurrentExample, showExample, showUpload } from './preview.ts'
import { screenFor } from './screens.ts'
import {
  EMPTY_MESSAGE,
  ERROR_EXAMPLE_FAILED,
  ERROR_UNSUPPORTED_TYPE,
  LOADING_MESSAGE,
  OPENING_MESSAGE,
  VIEWPORT_LABEL,
  type ViewportState,
} from './components/viewportState.ts'

const PHOTO_FRAME = '/examples/photo-frame.jpg'
const assetUrl = new URL('../public/examples/photo-frame.jpg', import.meta.url)

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
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

function readU16(file: Uint8Array, offset: number) {
  return ((file[offset] ?? 0) << 8) | (file[offset + 1] ?? 0)
}

function jpegSize(file: Uint8Array) {
  let offset = 2
  while (offset < file.length - 8) {
    if (file[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = file[offset + 1] ?? 0
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: readU16(file, offset + 5), width: readU16(file, offset + 7) }
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    offset += 2 + readU16(file, offset + 2)
  }
  return null
}

function imageFile(name: string, type: string) {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type })
}

function renderPair(selectedId: string | null, state: ViewportState) {
  return renderToStaticMarkup(
    <>
      <BoardScreen screen={screenFor('2.8')} state={state} />
      <ExamplesSection selectedId={selectedId} onSelect={() => {}} />
    </>,
  )
}

describe('photo frame example', () => {
  beforeEach(() => {
    FakeImage.fail = false
    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(URL, 'revokeObjectURL')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ships one still, with room for the later examples', () => {
    const file = new Uint8Array(readFileSync(assetUrl))
    expect(file.byteLength).toBe(12546)
    expect(createHash('sha256').update(file).digest('hex')).toBe(
      '7d9bd65978df9e7d3ff19b9764060f547f4c66dba43f2ddb75983b9f2edf8fe1',
    )
    expect(jpegSize(file)).toEqual({ width: 320, height: 240 })

    expect(examples).toEqual([
      {
        id: 'photo-frame',
        title: 'Photo frame',
        description: 'A still picture that fills the screen.',
        thumbnail: PHOTO_FRAME,
        kind: 'still',
        src: PHOTO_FRAME,
      },
    ])
  })

  it('selects Photo frame, shows Loading…, then paints the still', async () => {
    const published: Array<{ selectedId: string | null; state: ViewportState }> = []
    await showExample('photo-frame', null, (selectedId, state) => {
      published.push({ selectedId, state })
    })

    expect(published).toEqual([
      { selectedId: 'photo-frame', state: { status: 'loading' } },
      { selectedId: 'photo-frame', state: { status: 'content', src: PHOTO_FRAME } },
    ])

    const loading = renderPair('photo-frame', published[0]!.state)
    expect(loading).toContain(`class="viewport__copy">${LOADING_MESSAGE}</p>`)
    expect(loading).toContain(`class="visually-hidden">${LOADING_MESSAGE}</p>`)
    expect(loading).toContain(ON_THE_SCREEN)
    expect(loading).toContain('aria-checked="true"')

    const shown = renderPair('photo-frame', published[1]!.state)
    const landscape = screenFor('2.8')
    const portrait = screenFor('1.9')
    const tall = renderToStaticMarkup(
      <BoardScreen screen={portrait} state={published[1]!.state} />,
    )
    expect(shown).toContain(`src="${PHOTO_FRAME}"`)
    expect(shown).toContain('alt=""')
    expect(shown).toContain(`width="${landscape.width}"`)
    expect(shown).toContain(`height="${landscape.height}"`)
    expect(tall).toContain(`width="${portrait.width}"`)
    expect(tall).toContain(`height="${portrait.height}"`)
    expect(tall).toContain(`width:${portrait.width}px`)
    expect(tall).toContain(`height:${portrait.height}px`)
    expect(tall).toContain(`src="${PHOTO_FRAME}"`)
    expect(tall).toContain('alt=""')
    expect(shown).toContain('object-fit:cover')
    expect(shown).toContain(`aria-label="${VIEWPORT_LABEL}"`)
    expect(shown).toContain(ON_THE_SCREEN)
    expect(shown).not.toContain(EMPTY_MESSAGE)
    expect(shown).not.toContain(LOADING_MESSAGE)
    expect(
      keepsCurrentExample('photo-frame', published[1]!.state, 'photo-frame'),
    ).toBe(true)
  })

  it('clears the row when the example asset fails to load', async () => {
    FakeImage.fail = true
    const previous = URL.createObjectURL(imageFile('upload.png', 'image/png'))
    const published: Array<{ selectedId: string | null; state: ViewportState }> = []

    await showExample('photo-frame', previous, (selectedId, state) => {
      published.push({ selectedId, state })
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previous)
    expect(published).toEqual([
      { selectedId: 'photo-frame', state: { status: 'loading' } },
      {
        selectedId: null,
        state: { status: 'error', message: ERROR_EXAMPLE_FAILED, interior: 'plain' },
      },
    ])

    const html = renderPair(null, published[1]!.state)
    expect(html).toContain(`class="board-error">${ERROR_EXAMPLE_FAILED}</p>`)
    expect(html).toContain('data-interior="plain"')
    expect(html.toLowerCase()).toContain('background:#2a2a2a')
    expect(html).not.toContain(EMPTY_MESSAGE)
    expect(html).not.toContain('viewport__image')
    expect(html).not.toContain(ON_THE_SCREEN)
    expect(html).toContain('aria-checked="false"')
    expect(keepsCurrentExample('photo-frame', published[1]!.state, 'photo-frame')).toBe(false)
  })

  it('clears the example when a file is chosen and replaces an upload when the example is selected', async () => {
    const published: Array<{ selectedId: string | null; state: ViewportState }> = []
    const publish = (selectedId: string | null, state: ViewportState) => {
      published.push({ selectedId, state })
    }

    await showExample('photo-frame', null, publish)
    const uploadUrl = await showUpload(imageFile('photo.png', 'image/png'), null, publish)

    expect(uploadUrl).toMatch(/^blob:/)
    expect(published.at(-2)).toEqual({ selectedId: null, state: { status: 'opening' } })
    expect(published.at(-1)).toEqual({
      selectedId: null,
      state: { status: 'content', src: uploadUrl },
    })

    const opened = renderPair(null, { status: 'opening' })
    expect(opened).toContain(OPENING_MESSAGE)
    expect(opened).not.toContain(ON_THE_SCREEN)

    await showExample('photo-frame', uploadUrl, publish)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(uploadUrl)
    expect(published.at(-1)).toEqual({
      selectedId: 'photo-frame',
      state: { status: 'content', src: PHOTO_FRAME },
    })

    await showUpload(new File(['notes'], 'notes.txt', { type: 'text/plain' }), null, publish)
    expect(published.at(-2)).toEqual({ selectedId: null, state: { status: 'opening' } })
    expect(published.at(-1)).toEqual({
      selectedId: null,
      state: { status: 'error', message: ERROR_UNSUPPORTED_TYPE, interior: 'empty' },
    })
    if (uploadUrl) URL.revokeObjectURL(uploadUrl)
  })

  it('renders one unselected Photo frame row above Try your own', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html.indexOf('>Examples</h2>')).toBeLessThan(html.indexOf('>Try your own</h2>'))
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-labelledby="examples-heading"')
    expect(html).toContain('role="radio"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('Photo frame')
    expect(html).toContain('A still picture that fills the screen.')
    expect(html).toContain('width="64"')
    expect(html).toContain('height="48"')
    expect(html).toContain('alt=""')
    expect(html).not.toContain(ON_THE_SCREEN)
    expect(html).toContain(EMPTY_MESSAGE)

    expect(nextExampleIndex(0, 'ArrowDown', 1)).toBe(0)
    expect(nextExampleIndex(0, 'ArrowRight', 1)).toBe(0)
    expect(nextExampleIndex(0, 'ArrowUp', 1)).toBe(0)
    expect(nextExampleIndex(0, 'ArrowLeft', 1)).toBe(0)
    expect(nextExampleIndex(0, 'Enter', 1)).toBeNull()
    expect(nextExampleIndex(0, ' ', 1)).toBeNull()
    expect(nextExampleIndex(0, 'ArrowUp', 4)).toBe(3)
    expect(nextExampleIndex(1, 'ArrowDown', 4)).toBe(2)

    expect(pageCss).toContain('.example-thumb')
    expect(pageCss).toContain('width: 64px')
    expect(pageCss).toContain('height: 48px')
    expect(pageCss).toContain('border-radius: 4px')
    expect(pageCss).toContain('object-fit: cover')
    expect(pageCss).toContain('-webkit-line-clamp: 2')
    expect(pageCss).toContain('outline: 2px solid #0f766e')
    expect(pageCss).toContain('outline-offset: 2px')
    expect(pageCss).toContain('width: 3px')
  })
})
