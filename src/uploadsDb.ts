import { parseScreenCrops, type ScreenCrops } from './crop.ts'

export type UploadRecord = {
  id: string
  name: string
  type: string
  blob: Blob
  createdAt: number
  /** Per-screen crop and rotation from the crop editor. The blob itself is never changed. */
  crops?: ScreenCrops
}

const DB_NAME = 'esper-magician'
const DB_VERSION = 1
const STORE = 'uploads'

export function byNewest(a: UploadRecord, b: UploadRecord): number {
  return b.createdAt - a.createdAt
}

export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  const name = String(error.name)
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

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
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new DOMException('IndexedDB open failed', 'SecurityError'))
    }
  })
}

export async function openLibrary(): Promise<{ ok: true } | { ok: false; reason: 'unavailable' }> {
  try {
    const db = await openDb()
    db.close()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
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

        let request: IDBRequest<T>
        try {
          const tx = db.transaction(STORE, mode)
          request = makeRequest(tx.objectStore(STORE))
          tx.oncomplete = () => finish(null, request.result)
          tx.onabort = () => finish(tx.error ?? request.error ?? new DOMException('aborted', 'AbortError'))
          tx.onerror = (event) => {
            event.preventDefault()
          }
        } catch (error) {
          finish(error)
        }
      }),
  )
}

function parseRecord(value: unknown): UploadRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<UploadRecord>
  if (typeof record.id !== 'string' || record.id.length === 0) return null
  if (typeof record.name !== 'string') return null
  if (typeof record.type !== 'string') return null
  if (typeof record.createdAt !== 'number') return null
  if (!(record.blob instanceof Blob)) return null
  const crops = parseScreenCrops(record.crops)
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    blob: record.blob,
    createdAt: record.createdAt,
    ...(Object.keys(crops).length > 0 ? { crops } : {}),
  }
}

export async function listUploads(): Promise<UploadRecord[]> {
  const rows = await runTransaction<unknown[]>('readonly', (store) => store.getAll())
  return rows.flatMap((row) => {
    const record = parseRecord(row)
    return record ? [record] : []
  }).sort(byNewest)
}

export async function saveUpload(record: UploadRecord): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(record))
}

export async function deleteUpload(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id))
}
