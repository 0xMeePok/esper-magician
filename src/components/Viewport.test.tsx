import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import sheet from './board-screen.css?inline'
import pageCss from '../index.css?inline'
import { screenFor } from '../screens.ts'
import App from '../App.tsx'
import BoardScreen from './BoardScreen.tsx'
import Viewport from './Viewport.tsx'
import {
  BEZEL_WIDTH,
  EMPTY_HELPER,
  EMPTY_MESSAGE,
  ERROR_EXAMPLE_FAILED,
  ERROR_UNREADABLE_FILE,
  ERROR_UNSUPPORTED_TYPE,
  LOADING_MESSAGE,
  OPENING_MESSAGE,
  SCREEN_CAPTION,
  VIEWPORT_HEIGHT,
  VIEWPORT_LABEL,
  VIEWPORT_WIDTH,
  contentShowsStillFrame,
  coverDrawRect,
  isGifSrc,
  viewportAnnouncement,
  viewportColors,
  type ViewportState,
} from './viewportState.ts'

function renderScreen(state?: ViewportState) {
  return renderToStaticMarkup(<BoardScreen screen={screenFor('2.8')} state={state} />)
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = [0, 1, 2].map((index) => {
      const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('viewport state API', () => {
  it('keeps the exact copy later tickets need', () => {
    expect(VIEWPORT_LABEL).toBe('Screen preview')
    expect(SCREEN_CAPTION).toBe('Your screen (320 \u00d7 240)')
    expect(EMPTY_MESSAGE).toBe('Nothing on the screen yet.')
    expect(EMPTY_HELPER).toBe('Pick an example or upload a picture.')
    expect(LOADING_MESSAGE).toBe('Loading\u2026')
    expect(OPENING_MESSAGE).toBe('Opening your file\u2026')
    expect(ERROR_UNSUPPORTED_TYPE).toBe(
      'This file type isn\u2019t supported. Use a JPEG, PNG, WebP, or GIF.',
    )
    expect(ERROR_UNREADABLE_FILE).toBe(
      'This file couldn\u2019t be opened. Try a different picture or animation.',
    )
    expect(ERROR_EXAMPLE_FAILED).toBe(
      'This example couldn\u2019t be shown. Try another one or upload a picture.',
    )
  })

  it('maps each state to one status under the bezel', () => {
    expect(viewportAnnouncement({ status: 'empty' })).toEqual({
      kind: 'helper',
      text: EMPTY_HELPER,
    })
    expect(viewportAnnouncement({ status: 'loading' })).toEqual({
      kind: 'progress',
      text: LOADING_MESSAGE,
    })
    expect(viewportAnnouncement({ status: 'opening' })).toEqual({
      kind: 'progress',
      text: OPENING_MESSAGE,
    })
    expect(
      viewportAnnouncement({
        status: 'error',
        message: ERROR_EXAMPLE_FAILED,
        interior: 'plain',
      }),
    ).toEqual({ kind: 'error', text: ERROR_EXAMPLE_FAILED })
    expect(viewportAnnouncement({ status: 'content', src: '/photo.jpg' })).toEqual({
      kind: 'none',
    })
  })

  it('covers the 320×240 box without letterboxing, including smaller assets', () => {
    expect(coverDrawRect(320, 240)).toMatchObject({
      sx: 0,
      sy: 0,
      sw: 320,
      sh: 240,
      dw: VIEWPORT_WIDTH,
      dh: VIEWPORT_HEIGHT,
    })

    const wide = coverDrawRect(640, 240)
    expect(wide.dw).toBe(320)
    expect(wide.dh).toBe(240)
    expect(wide.sw).toBeCloseTo(320)
    expect(wide.sx).toBeCloseTo(160)

    const small = coverDrawRect(10, 10)
    expect(small.dw).toBe(VIEWPORT_WIDTH)
    expect(small.dh).toBe(VIEWPORT_HEIGHT)
    expect(small.sw).toBe(10)
    expect(small.sh).toBeCloseTo(7.5)
  })

  it('holds GIFs on the first frame only when reduced motion is requested', () => {
    expect(isGifSrc('/examples/loop.gif')).toBe(true)
    expect(isGifSrc('/examples/loop.GIF?v=1')).toBe(true)
    expect(isGifSrc('data:image/gif;base64,R0lGODlh')).toBe(true)
    expect(isGifSrc('/examples/still.png')).toBe(false)
    expect(isGifSrc('blob:http://localhost/picture')).toBe(false)

    expect(contentShowsStillFrame('/loop.gif', undefined, false)).toBe(false)
    expect(contentShowsStillFrame('/loop.gif', undefined, true)).toBe(true)
    expect(contentShowsStillFrame('/still.png', undefined, true)).toBe(false)
    expect(contentShowsStillFrame('blob:http://localhost/picture', true, true)).toBe(true)
  })
})

describe('board screen', () => {
  it('defaults the page to the empty state', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain(EMPTY_MESSAGE)
    expect(html).toContain(EMPTY_HELPER)
    expect(html).toContain(SCREEN_CAPTION)
    expect(html).toContain(`aria-label="${VIEWPORT_LABEL}"`)
    expect(html).toContain('class="page"')
    expect(html).toContain('class="preview-column"')
    expect(html).toContain('class="bezel-slot"')
    expect(html).not.toContain('class="board-stage"')
    expect(html).toContain('ESPER-MAGICIAN')
    expect(html).toContain('Examples')
    expect(html).toContain('Try your own')
    expect(html).not.toContain(LOADING_MESSAGE)
    expect(html).not.toContain('board-screen__scroll')
  })

  it('renders an empty screen with helper text outside the 320×240 opening', () => {
    const html = renderScreen()
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain(EMPTY_MESSAGE)
    expect(html).toContain(`class="helper">${EMPTY_HELPER}</p>`)
    expect(html).toContain('width:320px')
    expect(html).toContain('height:240px')
    expect(html).toContain('class="bezel-slot"')
    expect(html).toContain('--screen-width:320px')
    expect(html).toContain('--screen-height:240px')
    expect(html.toLowerCase()).toContain('background:#2a2a2a')
    expect(html).not.toContain('overflow-x:auto')
    expect(html).not.toContain('width:352px')
    expect(html).toContain('class="bezel-opening"')
    expect(html).toContain(`data-state="empty"`)

    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${describedBy}"`)
    expect(html.match(/aria-live=/g)).toHaveLength(1)
  })

  it('announces loading outside the viewport and shows a 24px spinner', () => {
    const html = renderScreen({ status: 'loading' })
    expect(html.split(LOADING_MESSAGE)).toHaveLength(3)
    expect(html).toContain(`class="visually-hidden">${LOADING_MESSAGE}</p>`)
    expect(html).toContain('width:24px')
    expect(html).toContain('height:24px')
    expect(html).not.toContain(EMPTY_HELPER)
    expect(html).not.toContain('board-error')
  })

  it('announces opening the same way, with the opening copy', () => {
    const html = renderScreen({ status: 'opening' })
    expect(html.split(OPENING_MESSAGE)).toHaveLength(3)
    expect(html).toContain(`class="visually-hidden">${OPENING_MESSAGE}</p>`)
    expect(html).not.toContain(EMPTY_MESSAGE)
    expect(html).not.toContain(EMPTY_HELPER)
  })

  it('shows upload errors on the empty interior with the error under the bezel', () => {
    const html = renderScreen({
      status: 'error',
      message: ERROR_UNSUPPORTED_TYPE,
      interior: 'empty',
    })
    expect(html).toContain(EMPTY_MESSAGE)
    expect(html).toContain(`class="board-error">${ERROR_UNSUPPORTED_TYPE}</p>`)
    expect(html).toContain('data-interior="empty"')
    expect(html.split(ERROR_UNSUPPORTED_TYPE)).toHaveLength(2)
    expect(html).not.toContain(EMPTY_HELPER)

    const unreadable = renderScreen({
      status: 'error',
      message: ERROR_UNREADABLE_FILE,
      interior: 'empty',
    })
    expect(unreadable).toContain(ERROR_UNREADABLE_FILE)
    expect(unreadable).toContain(EMPTY_MESSAGE)
  })

  it('shows an example load failure on a plain dark interior', () => {
    const html = renderScreen({
      status: 'error',
      message: ERROR_EXAMPLE_FAILED,
      interior: 'plain',
    })
    expect(html).not.toContain(EMPTY_MESSAGE)
    expect(html).not.toContain('viewport__copy')
    expect(html).toContain(`class="board-error">${ERROR_EXAMPLE_FAILED}</p>`)
    expect(html).toContain('data-interior="plain"')
    expect(html.toLowerCase()).toContain('background:#2a2a2a')
  })

  it('covers the opening with content and leaves the status slot empty', () => {
    const html = renderScreen({ status: 'content', src: '/examples/photo-frame.jpg' })
    expect(html).toContain('src="/examples/photo-frame.jpg"')
    expect(html).toContain('alt=""')
    expect(html).toContain('object-fit:cover')
    expect(html).toContain('object-position:center')
    expect(html).not.toContain(EMPTY_MESSAGE)
    expect(html).not.toContain(EMPTY_HELPER)
    expect(html).not.toContain('board-error')
    expect(html).not.toContain('visually-hidden')
    expect(html).toContain('data-state="content"')
  })

  it('draws a still canvas for animations when reduced motion is on', () => {
    const gif = renderToStaticMarkup(
      <Viewport
        state={{ status: 'content', src: '/examples/loop.gif' }}
        statusId="screen-status"
        reducedMotion
      />,
    )
    expect(gif).toContain('<canvas')
    expect(gif).toContain('width="320"')
    expect(gif).toContain('height="240"')
    expect(gif).not.toContain('<img')

    const still = renderToStaticMarkup(
      <Viewport
        state={{ status: 'content', src: '/examples/photo.png' }}
        statusId="screen-status"
        reducedMotion
      />,
    )
    expect(still).toContain('<img')
    expect(still).toContain('alt=""')
    expect(still).not.toContain('<canvas')

    const playing = renderToStaticMarkup(
      <Viewport
        state={{ status: 'content', src: 'blob:http://localhost/clip', animated: true }}
        statusId="screen-status"
        reducedMotion={false}
      />,
    )
    expect(playing).toContain('<img')
    expect(playing).not.toContain('<canvas')
  })
})

describe('viewport spec sheet', () => {
  const css = `${pageCss}\n${sheet}`

  it('locks the screen size, bezel, type, and error box', () => {
    expect(VIEWPORT_WIDTH).toBe(320)
    expect(VIEWPORT_HEIGHT).toBe(240)
    expect(BEZEL_WIDTH).toBe(352)
    expect(pageCss).toContain('--screen-width: 320px')
    expect(pageCss).toContain('--screen-height: 240px')
    expect(pageCss).toContain('--bezel-frame: 16px')
    expect(pageCss).toContain('--radius-bezel: 12px')
    expect(pageCss).toContain('border-radius: 0')
    expect(pageCss).not.toContain('.board-stage')
    expect(pageCss.match(/overflow-x:\s*auto/g)).toEqual(['overflow-x: auto'])
    expect(pageCss).toContain('.bezel-slot')
    expect(pageCss).toContain('--bezel-slot-height:')
    expect(pageCss).toContain('min-width: calc(320px + (var(--bezel-frame) * 2))')
    expect(sheet).toContain('calc(var(--screen-width) + (var(--bezel-frame) * 2))')
    expect(sheet).not.toContain('overflow-x')
    expect(sheet).toContain('width: 320px')
    expect(sheet).toContain('height: 240px')
    expect(sheet).toContain('object-fit: cover')
    expect(sheet).toContain('object-position: center')
    expect(css).toContain('font-size: 14px')
    expect(css).toContain('line-height: 20px')
    expect(sheet).toContain('padding: 8px 12px')
    expect(sheet).toContain('border-radius: 8px')
    expect(sheet).toContain('width: 24px')
    expect(sheet).toContain('height: 24px')
    expect(pageCss).toContain('--color-accent: #0f766e')
    expect(pageCss).toContain('outline: 2px solid var(--color-accent)')
    expect(pageCss).toContain('outline-offset: 2px')
    expect(sheet).toContain('prefers-reduced-motion: reduce')
    for (const color of Object.values(viewportColors)) {
      expect(css.toLowerCase()).toContain(color.toLowerCase())
    }
  })

  it('meets the contrast bar for viewport text and errors', () => {
    expect(contrastRatio(viewportColors.inViewportText, viewportColors.emptyFill)).toBeGreaterThanOrEqual(
      4.5,
    )
    expect(contrastRatio(viewportColors.errorText, viewportColors.errorBg)).toBeGreaterThanOrEqual(4.5)
  })
})
