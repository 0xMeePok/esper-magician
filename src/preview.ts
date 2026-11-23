import { exampleById, type Example } from './examples.ts'
import { openPreview, type OpenedMedia } from './upload.ts'
import { ERROR_EXAMPLE_FAILED, type ViewportState } from './components/viewportState.ts'

export type PreviewPublish = (selectedId: string | null, state: ViewportState) => void

function loadImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = src
  })
}

function revokeObjectUrl(url: string | null) {
  if (url) URL.revokeObjectURL(url)
}

async function paintExample(example: Example): Promise<ViewportState> {
  switch (example.kind) {
    case 'still':
    case 'animation': {
      const ok = await loadImage(example.src)
      if (!ok) {
        return { status: 'error', message: ERROR_EXAMPLE_FAILED, interior: 'plain' }
      }
      return example.kind === 'animation'
        ? { status: 'content', src: example.src, animated: true }
        : { status: 'content', src: example.src }
    }
    case 'clock':
      return { status: 'layout', layout: 'clock' }
    case 'card':
      return { status: 'layout', layout: 'card' }
    default: {
      const unreachable: never = example
      return unreachable
    }
  }
}

export function keepsCurrentExample(
  selectedId: string | null,
  state: ViewportState,
  id: string,
): boolean {
  return (
    selectedId === id &&
    (state.status === 'content' || state.status === 'layout' || state.status === 'loading')
  )
}

export async function showExample(
  id: string,
  previousUrl: string | null,
  publish: PreviewPublish,
): Promise<void> {
  const example = exampleById(id)
  if (!example) return

  revokeObjectUrl(previousUrl)
  publish(id, { status: 'loading' })

  const next = await paintExample(example)
  publish(next.status === 'error' ? null : id, next)
}

export function showUpload(
  file: File,
  previousUrl: string | null,
  publish: PreviewPublish,
  onOpened?: (media: OpenedMedia) => void,
): Promise<string | null> {
  return openPreview(
    file,
    previousUrl,
    (state) => {
      publish(null, state)
    },
    onOpened,
  )
}
