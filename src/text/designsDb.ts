/**
 * Saved text designs, kept in this browser (IndexedDB) with their pictures, so they can be
 * opened and changed again later. A database of their own, apart from the uploads.
 */
import { parseDesign, type Design } from './design.ts'

export type SavedDesign = Design & {
  /** A small picture of it, for the list. */
  thumbnail?: Blob
}

const DB_NAME = 'esper-magician-designs'
const DB_VERSION = 1
const STORE = 'designs'

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    return Promise.reject(new DOMException('IndexedDB is unavailable', 'SecurityError'))
  }
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new DOMException('IndexedDB is unavailable', 'SecurityError'))
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new DOMException('IndexedDB open failed', 'SecurityError'))
  })
}

function run<T>(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false
        const finish = (error: unknown, value?: T) => {
          if (settled) return
          settled = true
          db.close()
          if (error) reject(error)
          else resolve(value as T)
        }
        try {
          const tx = db.transaction(STORE, mode)
          const request = makeRequest(tx.objectStore(STORE))
          tx.oncomplete = () => finish(null, request.result)
          tx.onabort = () => finish(tx.error ?? request.error ?? new DOMException('aborted', 'AbortError'))
          tx.onerror = (event) => event.preventDefault()
        } catch (error) {
          finish(error)
        }
      }),
  )
}

function parseSaved(value: unknown): SavedDesign | null {
  const design = parseDesign(value)
  if (!design) return null
  const thumbnail = (value as { thumbnail?: unknown }).thumbnail
  return thumbnail instanceof Blob ? { ...design, thumbnail } : design
}

/** Newest change first. */
export async function listDesigns(): Promise<SavedDesign[]> {
  const rows = await run<unknown[]>('readonly', (store) => store.getAll())
  return rows.flatMap((row) => parseSaved(row) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveDesign(design: SavedDesign): Promise<void> {
  await run('readwrite', (store) => store.put(design))
}

export async function deleteDesign(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id))
}
