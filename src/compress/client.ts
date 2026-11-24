import type { ScreenCrop, Size } from '../crop.ts'
import type { EncodedResult } from './gif.ts'
import type { CompressMessage, CompressRequest } from './worker.ts'

export type CompressJob = {
  file: Blob
  animated: boolean
  screen: Size
  crop: ScreenCrop | null
  onProgress?: (done: number) => void
}

export type Compressor = (job: CompressJob) => Promise<EncodedResult[]>

let nextId = 1

/** Runs one compression in its own Web Worker, so the page stays responsive. */
export const workerCompressor: Compressor = (job) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const id = nextId++
    const stop = () => worker.terminate()
    worker.onmessage = (event: MessageEvent<CompressMessage>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.type === 'progress') job.onProgress?.(message.done)
      else if (message.type === 'done') {
        stop()
        resolve(message.results)
      } else {
        stop()
        reject(new Error(message.message))
      }
    }
    worker.onerror = (event) => {
      stop()
      reject(new Error(event.message || 'Compression failed.'))
    }
    const request: CompressRequest = {
      id,
      file: job.file,
      animated: job.animated,
      screen: job.screen,
      crop: job.crop,
    }
    worker.postMessage(request)
  })

let active: Compressor = workerCompressor

export function compressor(): Compressor {
  return active
}

/** Tests swap in a fake; pass nothing to restore the Web Worker. */
export function setCompressor(next?: Compressor) {
  active = next ?? workerCompressor
}
