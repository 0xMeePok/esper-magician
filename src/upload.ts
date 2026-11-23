import {
  ERROR_UNREADABLE_FILE,
  ERROR_UNSUPPORTED_TYPE,
  type ViewportState,
} from './components/viewportState.ts'

const STILL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const STILL_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

function fileMime(file: File): string {
  return file.type.toLowerCase().split(';')[0]?.trim() ?? ''
}

function hasExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

function uploadKind(file: File): 'still' | 'unsupported' {
  if (file.size === 0) return 'unsupported'
  if (STILL_TYPES.has(fileMime(file)) || hasExtension(file.name, STILL_EXTENSIONS)) return 'still'
  return 'unsupported'
}

function decodeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = src
  })
}

function letOpeningPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

export async function openPreview(
  file: File,
  previousUrl: string | null,
  publish: (state: ViewportState) => void,
): Promise<string | null> {
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  publish({ status: 'opening' })

  if (uploadKind(file) !== 'still') {
    await letOpeningPaint()
    publish({ status: 'error', message: ERROR_UNSUPPORTED_TYPE, interior: 'empty' })
    return null
  }

  const url = URL.createObjectURL(file)
  let decoded = false
  try {
    decoded = await decodeImage(url)
  } catch {
    decoded = false
  }
  if (!decoded) {
    URL.revokeObjectURL(url)
    publish({ status: 'error', message: ERROR_UNREADABLE_FILE, interior: 'empty' })
    return null
  }

  publish({ status: 'content', src: url })
  return url
}
