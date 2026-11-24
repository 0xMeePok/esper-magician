import type { Size } from '../crop.ts'
import { infoCardSizes } from '../exampleLayout.ts'
import { INFO_CARD_LINE, INFO_CARD_TITLE } from '../examples.ts'

const FONT = 'system-ui, sans-serif'
const BACKGROUND = '#eff6ff'
const TITLE = '#111111'
const LINE = '#4a4a4a'
const ICON = '#0F766E'
const GAP = 8
const ICON_SIZE = 32

/**
 * Draws the Info card example as a picture, laid out like the preview (InfoCard.tsx), so it can go
 * on the screen like any other still.
 */
export function drawInfoCard(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, size: Size) {
  const sizes = infoCardSizes(size.width)
  context.fillStyle = BACKGROUND
  context.fillRect(0, 0, size.width, size.height)

  const total = ICON_SIZE + GAP + sizes.titleLine + GAP + sizes.lineHeight
  const left = sizes.padding
  let top = Math.round((size.height - total) / 2)

  // Sun icon, from the 32×32 SVG in InfoCard.tsx.
  context.fillStyle = ICON
  context.beginPath()
  context.arc(left + 16, top + 16, 6, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = ICON
  context.lineWidth = 2.5
  context.lineCap = 'round'
  const rays: Array<[number, number, number, number]> = [
    [16, 2.5, 16, 6.5], [16, 25.5, 16, 29.5], [2.5, 16, 6.5, 16], [25.5, 16, 29.5, 16],
    [6.5, 6.5, 9.3, 9.3], [22.7, 22.7, 25.5, 25.5], [6.5, 25.5, 9.3, 22.7], [22.7, 9.3, 25.5, 6.5],
  ]
  context.beginPath()
  for (const [x1, y1, x2, y2] of rays) {
    context.moveTo(left + x1, top + y1)
    context.lineTo(left + x2, top + y2)
  }
  context.stroke()
  top += ICON_SIZE + GAP

  context.textBaseline = 'middle'
  context.fillStyle = TITLE
  context.font = `600 ${sizes.title}px ${FONT}`
  context.fillText(INFO_CARD_TITLE, left, top + sizes.titleLine / 2)
  top += sizes.titleLine + GAP

  context.fillStyle = LINE
  context.font = `400 ${sizes.line}px ${FONT}`
  context.fillText(INFO_CARD_LINE, left, top + sizes.lineHeight / 2)
}

/** The Info card as a PNG at the screen's size. */
export async function infoCardPicture(size: Size): Promise<Blob> {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas in this browser.')
  drawInfoCard(context, size)
  return canvas.convertToBlob({ type: 'image/png' })
}
