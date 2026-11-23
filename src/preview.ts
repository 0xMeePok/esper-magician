import { exampleById, type Example } from './examples.ts'
import { openPreview } from './upload.ts'
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
    case 'still': {
      const ok = await loadImage(example.src)
      if (!ok) {
        return { status: 'error', message: ERROR_EXAMPLE_FAILED, interior: 'plain' }
      }
      return { status: 'content', src: example.src }
    }
    default: {
      const unreachable: never = example.kind
      return unreachable
    }
  }
}

export function keepsCurrentExample(
  selectedId: string | null,
  state: ViewportState,
  id: string,
): boolean {
  return selectedId === id && (state.status === 'content' || state.status === 'loading')
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
  publish(next.status === 'content' ? id : null, next)
}

export function showUpload(
  file: File,
  previousUrl: string | null,
  publish: PreviewPublish,
): Promise<string | null> {
  return openPreview(file, previousUrl, (state) => {
    publish(null, state)
  })
}
