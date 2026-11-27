import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QUOTA_MESSAGE,
  REMOVED_MESSAGE,
  SAVED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  focusAfterDelete,
  initialUploadListState,
  moveTileIndex,
  tileLabel,
  uploadListReducer,
  type UploadListState,
} from './uploadList.ts'
import {
  deleteUpload,
  isQuotaError,
  listUploads,
  openLibrary,
  saveUpload,
  type UploadRecord,
} from './uploadsDb.ts'

function record(name: string, createdAt: number, type = 'image/png'): UploadRecord {
  return {
    id: `${name}-${createdAt}`,
    name,
    type,
    blob: new Blob([name], { type }),
    createdAt,
  }
}

describe('upload records', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    globalThis.indexedDB = new IDBFactory()
  })

  it('saves a file and lists it again newest first', async () => {
    const older = record('older.png', 1)
    const newer = record('newer.jpg', 2, 'image/jpeg')
    await saveUpload(older)
    await saveUpload(newer)

    const firstRead = await listUploads()
    const secondRead = await listUploads()

    expect(firstRead.map((item) => item.name)).toEqual(['newer.jpg', 'older.png'])
    expect(secondRead.map((item) => [item.id, item.name, item.type, item.createdAt])).toEqual(
      firstRead.map((item) => [item.id, item.name, item.type, item.createdAt]),
    )
    expect(await secondRead[0]?.blob.text()).toBe('newer.jpg')
    expect(secondRead[0]?.blob.type).toBe('image/jpeg')
  })

  it('keeps per-screen crops with the saved upload and drops broken ones', async () => {
    const cropped: UploadRecord = {
      ...record('beach.png', 3),
      crops: {
        '1.9': { rotationDeg: 90, cropRect: { x: 10, y: 20, width: 400, height: 300 } },
      },
    }
    await saveUpload(cropped)
    await saveUpload({
      ...record('odd.png', 4),
      crops: { '1.9': { rotationDeg: 45, cropRect: { x: 0, y: 0, width: 1, height: 1 } } } as never,
    })

    const [odd, beach] = await listUploads()
    expect(beach?.crops).toEqual(cropped.crops)
    expect(await beach?.blob.text()).toBe('beach.png')
    expect(odd?.name).toBe('odd.png')
    expect(odd?.crops).toBeUndefined()

    await saveUpload({ ...cropped, crops: {} })
    const [, cleared] = await listUploads()
    expect(cleared?.crops).toBeUndefined()
    expect(await cleared?.blob.text()).toBe('beach.png')
  })

  it('keeps a second copy when the same file is saved again', async () => {
    const first = record('same.png', 1)
    const second = { ...record('same.png', 2), id: 'other-id' }
    await saveUpload(first)
    await saveUpload(second)

    const items = await listUploads()
    expect(items.map((item) => item.id)).toEqual(['other-id', first.id])
  })

  it('deletes a record from the library', async () => {
    const kept = record('kept.png', 1)
    const gone = record('gone.png', 2)
    await saveUpload(kept)
    await saveUpload(gone)

    await deleteUpload(gone.id)

    const items = await listUploads()
    expect(items.map((item) => item.id)).toEqual([kept.id])
  })

  it('rejects a quota failure and keeps records already stored', async () => {
    const kept = record('kept.png', 1)
    await saveUpload(kept)
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    const failed = record('new.png', 2)
    await expect(saveUpload(failed)).rejects.toSatisfy(isQuotaError)
    expect(await listUploads()).toMatchObject([{ id: kept.id, name: 'kept.png' }])
  })

  it('reports storage as unavailable when IndexedDB cannot open', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(openLibrary()).resolves.toEqual({ ok: false, reason: 'unavailable' })

    vi.stubGlobal('indexedDB', {
      open() {
        const request = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onupgradeneeded: null as (() => void) | null,
          error: new DOMException('blocked', 'SecurityError'),
        }
        queueMicrotask(() => request.onerror?.())
        return request
      },
    })
    await expect(openLibrary()).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })
})

function ready(items: UploadRecord[]): UploadListState {
  return { ...initialUploadListState, phase: 'ready', items }
}

describe('upload list', () => {
  it('selects a new upload and announces the save', () => {
    const older = record('older.png', 1)
    const newer = record('newer.png', 2)
    const next = uploadListReducer(ready([older]), { type: 'added', record: newer, select: true })

    expect(next.items.map((item) => item.id)).toEqual([newer.id, older.id])
    expect(next.selectedId).toBe(newer.id)
    expect(next.saveError).toBeNull()
    expect(next.announcement).toBe(SAVED_MESSAGE)
  })

  it('restores saved items with nothing selected', () => {
    const items = [record('newer.png', 2), record('older.png', 1)]
    const next = uploadListReducer(initialUploadListState, { type: 'loaded', items })

    expect(next.phase).toBe('ready')
    expect(next.items.map((item) => item.name)).toEqual(['newer.png', 'older.png'])
    expect(next.selectedId).toBeNull()
    expect(next.announcement).toBe('')
  })

  it('removes a deleted item and announces it', () => {
    const first = record('first.png', 2)
    const second = record('second.png', 1)
    const next = uploadListReducer(ready([first, second]), { type: 'deleted', id: first.id })

    expect(next.items.map((item) => item.id)).toEqual([second.id])
    expect(next.selectedId).toBeNull()
    expect(next.announcement).toBe(REMOVED_MESSAGE)
  })

  it('keeps the preview out of the library when storage is full', () => {
    const kept = record('kept.png', 1)
    const selected = uploadListReducer(
      { ...ready([kept]), selectedId: kept.id },
      { type: 'quota' },
    )

    expect(selected.items).toEqual([kept])
    expect(selected.selectedId).toBeNull()
    expect(selected.saveError).toBe(QUOTA_MESSAGE)
    expect(selected.announcement).toBe(QUOTA_MESSAGE)
  })

  it('announces when storage is unavailable and does not promise a library', () => {
    const next = uploadListReducer(initialUploadListState, { type: 'unavailable' })

    expect(next.phase).toBe('unavailable')
    expect(next.items).toEqual([])
    expect(next.announcement).toBe(UNAVAILABLE_MESSAGE)
  })

  it('names tiles and moves the keyboard focus without wrapping', () => {
    expect(tileLabel('sunset.jpg', 'image/jpeg', null)).toBe('sunset.jpg, picture')
    expect(tileLabel('sunset.jpg', 'image/jpeg', 'on-screen')).toBe('sunset.jpg, picture, On the screen')
    expect(tileLabel('cat.gif', 'image/gif', null)).toBe('cat.gif, animation')
    expect(tileLabel('clip.GIF', '', 'selected')).toBe('clip.GIF, animation, Selected')

    expect(moveTileIndex(1, 5, 'ArrowLeft')).toBe(0)
    expect(moveTileIndex(0, 5, 'ArrowLeft')).toBe(0)
    expect(moveTileIndex(4, 5, 'ArrowRight')).toBe(4)
    expect(moveTileIndex(1, 5, 'ArrowDown')).toBe(4)
    expect(moveTileIndex(4, 5, 'ArrowDown')).toBe(4)
    expect(moveTileIndex(3, 5, 'ArrowUp')).toBe(0)
    expect(moveTileIndex(2, 5, 'Home')).toBe(0)
    expect(moveTileIndex(0, 5, 'End')).toBe(4)
    expect(moveTileIndex(0, 5, 'Enter')).toBeNull()

    expect(focusAfterDelete(0, 2)).toBe(0)
    expect(focusAfterDelete(2, 2)).toBe(1)
    expect(focusAfterDelete(0, 0)).toBe('heading')
  })
})
