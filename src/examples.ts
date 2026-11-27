type ExampleDetails = {
  id: string
  title: string
  description: string
  thumbnail: string
}

/** A bitmap shown with the contain framing rule. */
export type BitmapExample = ExampleDetails & {
  kind: 'still' | 'animation'
  src: string
}

/** Laid out to the selected screen's exact pixels. */
export type LayoutExample = ExampleDetails & {
  kind: 'clock' | 'card'
}

export type Example = BitmapExample | LayoutExample

export const ON_THE_SCREEN = 'On the screen'
export const SELECTED = 'Selected'

export const INFO_CARD_TITLE = 'Today'
export const INFO_CARD_LINE = 'Sunny and warm'

export const examples: Example[] = [
  {
    id: 'photo-frame',
    title: 'Photo frame',
    description: 'A still picture that fills the screen.',
    thumbnail: '/examples/photo-frame.jpg',
    kind: 'still',
    src: '/examples/photo-frame.jpg',
  },
  {
    id: 'animation-loop',
    title: 'Animation loop',
    description: 'A short animation that plays over and over.',
    thumbnail: '/examples/animation-loop-thumb.png',
    kind: 'animation',
    src: '/examples/animation-loop.gif',
  },
  {
    id: 'digital-clock',
    title: 'Digital clock',
    description: 'A large, easy-to-read clock for the screen.',
    thumbnail: '/examples/digital-clock-thumb.svg',
    kind: 'clock',
  },
  {
    id: 'info-card',
    title: 'Info card',
    description: 'A simple card with a title, a short line, and an icon.',
    thumbnail: '/examples/info-card-thumb.svg',
    kind: 'card',
  },
]

export function exampleById(id: string): Example | undefined {
  return examples.find((example) => example.id === id)
}

export function nextExampleIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowDown' || key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (current - 1 + count) % count
  return null
}
