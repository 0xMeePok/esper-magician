type ExampleDetails = {
  id: string
  title: string
  description: string
  thumbnail: string
}

export type Example = ExampleDetails & {
  kind: 'still'
  src: string
}

export const ON_THE_SCREEN = 'On the screen'

export const examples: Example[] = [
  {
    id: 'photo-frame',
    title: 'Photo frame',
    description: 'A still picture that fills the screen.',
    thumbnail: '/examples/photo-frame.jpg',
    kind: 'still',
    src: '/examples/photo-frame.jpg',
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
