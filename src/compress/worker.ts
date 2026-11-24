import type { ScreenCrop, Size } from '../crop.ts'
import { compressGif, type EncodedResult } from './gif.ts'
import { compressStill } from './still.ts'
import { STRENGTHS } from './strengths.ts'

export type CompressRequest = {
  id: number
  file: Blob
  animated: boolean
  screen: Size
  crop: ScreenCrop | null
}

export type CompressMessage =
  | { id: number; type: 'progress'; done: number }
  | { id: number; type: 'done'; results: EncodedResult[] }
  | { id: number; type: 'error'; message: string }

async function decodeStill(file: Blob) {
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas in this browser.')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  return { data: pixels.data, width: pixels.width, height: pixels.height }
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<CompressRequest>) => void) | null
  postMessage(message: CompressMessage, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { id, file, animated, screen, crop } = event.data
  const post = (message: CompressMessage, transfer: Transferable[] = []) =>
    scope.postMessage(message, transfer)
  try {
    let results: EncodedResult[]
    if (animated) {
      let last = 0
      results = compressGif(await file.arrayBuffer(), STRENGTHS, screen, crop, (done) => {
        if (done - last >= 0.02 || done === 1) {
          last = done
          post({ id, type: 'progress', done })
        }
      })
    } else {
      post({ id, type: 'progress', done: 0.1 })
      results = await compressStill(await decodeStill(file), STRENGTHS, screen, crop)
      post({ id, type: 'progress', done: 1 })
    }
    post({ id, type: 'done', results }, results.map((result) => result.bytes.buffer))
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
