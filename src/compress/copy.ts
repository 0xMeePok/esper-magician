import { formatBytes } from '../flashLayout.ts'

export const COMPRESSION_COPY = {
  heading: 'Too big for your screen',
  working: 'Making it smaller…',
  noneFit:
    'This file is too big to fit on your screen, even with strong compression. Try a shorter GIF or a smaller picture.',
  failed: 'This file couldn’t be compressed. Try a different picture or animation.',
  showOriginal: 'Show original',
  showCompressed: 'Show compressed',
} as const

export function compressionBody(originalBytes: number, budget: number, canShrink = true): string {
  const sizes = `This file is ${formatBytes(originalBytes)}. Your screen has room for ${formatBytes(budget)}.`
  return canShrink ? `${sizes} Pick how much to shrink it.` : sizes
}

export function readout(label: string, bytes: number, budget: number): string {
  return `Compressed (${label}) · ${formatBytes(bytes)} of ${formatBytes(budget)}`
}
