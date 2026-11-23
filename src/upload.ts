import {
  ERROR_UNREADABLE_FILE,
  ERROR_UNSUPPORTED_TYPE,
  type ViewportState,
} from './components/viewportState.ts'

const STILL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const STILL_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const GIF_TYPE = 'image/gif'
const GIF_EXTENSION = '.gif'

function fileMime(file: { type: string }): string {
  return file.type.toLowerCase().split(';')[0]?.trim() ?? ''
}

function hasExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

export function mediaKind(file: {
  name: string
  type: string
  size: number
}): 'still' | 'animated' | 'unsupported' {
  if (file.size === 0) return 'unsupported'
  const mime = fileMime(file)
  if (mime === GIF_TYPE || hasExtension(file.name, [GIF_EXTENSION])) return 'animated'
  if (STILL_TYPES.has(mime) || hasExtension(file.name, STILL_EXTENSIONS)) return 'still'
  return 'unsupported'
}

export function isAnimatedMedia(name: string, type: string): boolean {
  return mediaKind({ name, type, size: 1 }) === 'animated'
}

/** What a decoded upload looks like, for framing and cropping. */
export type OpenedMedia = { url: string; width: number; height: number; animated: boolean }

/** Resolves with the decoded pixel size, or null when the browser can't read the file. */
export function decodeImage(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
    }
    image.onerror = () => resolve(null)
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
  onOpened?: (media: OpenedMedia) => void,
): Promise<string | null> {
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  publish({ status: 'opening' })

  const kind = mediaKind(file)
  if (kind === 'unsupported') {
    await letOpeningPaint()
    publish({ status: 'error', message: ERROR_UNSUPPORTED_TYPE, interior: 'empty' })
    return null
  }

  const url = URL.createObjectURL(file)
  let decoded: { width: number; height: number } | null = null
  try {
    decoded = await decodeImage(url)
  } catch {
    decoded = null
  }
  if (!decoded) {
    URL.revokeObjectURL(url)
    publish({ status: 'error', message: ERROR_UNREADABLE_FILE, interior: 'empty' })
    return null
  }

  onOpened?.({ url, width: decoded.width, height: decoded.height, animated: kind === 'animated' })
  publish(
    kind === 'animated'
      ? { status: 'content', src: url, animated: true }
      : { status: 'content', src: url },
  )
  return url
}
