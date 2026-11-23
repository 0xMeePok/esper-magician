import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BoardScreen from './components/BoardScreen.tsx'
import Viewport from './components/Viewport.tsx'
import { screenFor } from './screens.ts'
import { openPreview } from './upload.ts'
import {
  EMPTY_MESSAGE,
  ERROR_UNREADABLE_FILE,
  ERROR_UNSUPPORTED_TYPE,
  OPENING_MESSAGE,
  VIEWPORT_LABEL,
  type ViewportState,
} from './components/viewportState.ts'

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function imageFile(name: string, type: string) {
  return new File([bytes], name, { type })
}

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

function render(state: ViewportState) {
  return renderToStaticMarkup(<BoardScreen screen={screenFor('2.8')} state={state} />)
}

async function preview(file: File, previousUrl: string | null = null) {
  const states: ViewportState[] = []
  const url = await openPreview(file, previousUrl, (state) => {
    states.push(state)
  })
  return { states, url, state: states[states.length - 1] }
}

describe('upload preview', () => {
  beforeEach(() => {
    FakeImage.fail = false
    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(URL, 'revokeObjectURL')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a valid PNG in the viewport', async () => {
    const result = await preview(imageFile('photo.png', 'image/png'))

    expect(result.states.map((state) => state.status)).toEqual(['opening', 'content'])
    expect(result.state).toEqual({ status: 'content', src: result.url })
    expect(result.url).toMatch(/^blob:/)

    const html = render(result.state!)
    expect(html).toContain(`src="${result.url}"`)
    expect(html).toContain('alt=""')
    expect(html).toContain('object-fit:cover')
    expect(html).toContain('object-position:center')
    expect(html).toContain(`aria-label="${VIEWPORT_LABEL}"`)
    expect(html).not.toContain(EMPTY_MESSAGE)
    expect(html).not.toContain(OPENING_MESSAGE)
    if (result.url) URL.revokeObjectURL(result.url)
  })

  it('accepts JPEG and WebP by MIME or extension', async () => {
    const files = [
      imageFile('photo.jpg', 'image/jpeg'),
      imageFile('photo.webp', 'image/webp'),
      imageFile('scan.PNG', ''),
      imageFile('scan.jpeg', 'application/octet-stream'),
    ]

    for (const file of files) {
      const result = await preview(file)
      expect(result.state?.status).toBe('content')
      if (result.url) URL.revokeObjectURL(result.url)
    }
  })

  it('keeps the empty viewport when the file type is unsupported', async () => {
    const files = [
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      new File([], 'empty.png', { type: 'image/png' }),
      new File([], 'empty.gif', { type: 'image/gif' }),
      new File([bytes], 'mystery', { type: '' }),
    ]

    for (const file of files) {
      const result = await preview(file)
      expect(result.url).toBeNull()
      expect(result.states[0]).toEqual({ status: 'opening' })
      expect(result.state).toEqual({
        status: 'error',
        message: ERROR_UNSUPPORTED_TYPE,
        interior: 'empty',
      })

      const html = render(result.state!)
      expect(html).toContain(EMPTY_MESSAGE)
      expect(html).toContain(`class="board-error">${ERROR_UNSUPPORTED_TYPE}</p>`)
      expect(html).toContain('data-interior="empty"')
      expect(html).not.toContain('<img')
    }
  })

  it('shows the unreadable error when the image cannot be decoded', async () => {
    FakeImage.fail = true
    const created = vi.spyOn(URL, 'createObjectURL')
    const result = await preview(imageFile('corrupt.png', 'image/png'))

    expect(result.url).toBeNull()
    expect(result.state).toEqual({
      status: 'error',
      message: ERROR_UNREADABLE_FILE,
      interior: 'empty',
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(created.mock.results[0]?.value)

    const html = render(result.state!)
    expect(html).toContain(EMPTY_MESSAGE)
    expect(html).toContain(`class="board-error">${ERROR_UNREADABLE_FILE}</p>`)
    expect(html).not.toContain('<img')
  })

  it('revokes the previous object URL when a new file is chosen', async () => {
    const first = await preview(imageFile('first.png', 'image/png'))
    const second = await preview(imageFile('second.png', 'image/png'), first.url)

    expect(first.url).toMatch(/^blob:/)
    expect(second.url).toMatch(/^blob:/)
    expect(second.url).not.toBe(first.url)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first.url)
    expect(second.state).toEqual({ status: 'content', src: second.url })
    if (second.url) URL.revokeObjectURL(second.url)
  })

  it('shows a GIF in the viewport and holds the first frame when reduced motion is on', async () => {
    const result = await preview(imageFile('loop.gif', 'image/gif'))
    expect(result.states.map((state) => state.status)).toEqual(['opening', 'content'])
    expect(result.state).toEqual({ status: 'content', src: result.url, animated: true })

    const screen = screenFor('2.8')
    const playing = renderToStaticMarkup(
      <Viewport
        state={result.state!}
        statusId="screen-status"
        width={screen.width}
        height={screen.height}
        reducedMotion={false}
      />,
    )
    expect(playing).toContain('<img')
    expect(playing).toContain('alt=""')
    expect(playing).toContain('object-fit:cover')
    expect(playing).toContain('object-position:center')
    expect(playing).not.toContain('<canvas')

    const still = renderToStaticMarkup(
      <Viewport
        state={result.state!}
        statusId="screen-status"
        width={screen.width}
        height={screen.height}
        reducedMotion
      />,
    )
    expect(still).toContain('<canvas')
    expect(still).toContain('width="320"')
    expect(still).toContain('height="240"')
    expect(still).not.toContain('<img')

    const byExtension = await preview(imageFile('clip.GIF', ''))
    expect(byExtension.state).toEqual({
      status: 'content',
      src: byExtension.url,
      animated: true,
    })
    if (result.url) URL.revokeObjectURL(result.url)
    if (byExtension.url) URL.revokeObjectURL(byExtension.url)
  })

  it('accepts a GIF of at least 4 MB', async () => {
    const file = new File([new Uint8Array(4 * 1024 * 1024)], 'big.gif', { type: 'image/gif' })
    const result = await preview(file)

    expect(file.size).toBeGreaterThanOrEqual(4 * 1024 * 1024)
    expect(result.state).toEqual({ status: 'content', src: result.url, animated: true })
    if (result.url) URL.revokeObjectURL(result.url)
  })
})
