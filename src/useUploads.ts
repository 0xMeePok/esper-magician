import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ViewportState } from './components/viewportState.ts'
import type { UploadTile } from './uploadList.ts'
import { initialUploadListState, uploadListReducer } from './uploadList.ts'
import { isAnimatedMedia, openPreview } from './upload.ts'
import {
  deleteUpload,
  isQuotaError,
  listUploads,
  openLibrary,
  saveUpload,
  type UploadRecord,
} from './uploadsDb.ts'

export function useUploads() {
  const [list, dispatch] = useReducer(uploadListReducer, initialUploadListState)
  const [viewport, setViewport] = useState<ViewportState>({ status: 'empty' })
  const listRef = useRef(list)
  const phaseRef = useRef(list.phase)
  const urlRef = useRef<string | null>(null)
  const requestRef = useRef(0)
  const clockRef = useRef(0)
  const waitsRef = useRef<number[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listRef.current = list
    phaseRef.current = list.phase
  }, [list])

  const tiles = useMemo<UploadTile[]>(
    () =>
      list.items.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        animated: isAnimatedMedia(item.name, item.type),
        src: URL.createObjectURL(item.blob),
      })),
    [list.items],
  )

  useEffect(() => {
    return () => {
      for (const tile of tiles) URL.revokeObjectURL(tile.src)
    }
  }, [tiles])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const opened = await openLibrary()
      if (cancelled) return
      if (!opened.ok) {
        dispatch({ type: 'unavailable' })
        return
      }
      const items = await listUploads()
      if (cancelled) return
      dispatch({ type: 'loaded', items })
    })()

    const request = requestRef
    const url = urlRef
    const waits = waitsRef
    return () => {
      cancelled = true
      request.current += 1
      const src = url.current
      if (src) URL.revokeObjectURL(src)
      for (const id of waits.current) window.clearInterval(id)
    }
  }, [])

  function waitForPhase(): Promise<void> {
    if (phaseRef.current !== 'loading') return Promise.resolve()
    return new Promise((resolve) => {
      const id = window.setInterval(() => {
        if (phaseRef.current === 'loading') return
        window.clearInterval(id)
        resolve()
      }, 16)
      waitsRef.current.push(id)
    })
  }

  function stamp(): number {
    const now = Date.now()
    clockRef.current = Math.max(now, clockRef.current + 1)
    return clockRef.current
  }

  async function showFile(file: File): Promise<{ request: number; url: string | null }> {
    const request = ++requestRef.current
    const previous = urlRef.current
    urlRef.current = null
    const url = await openPreview(file, previous, (next) => {
      if (requestRef.current !== request) return
      if (next.status === 'content') urlRef.current = next.src
      setViewport(next)
    })
    if (requestRef.current !== request && url) URL.revokeObjectURL(url)
    return { request, url }
  }

  async function openFile(file: File) {
    dispatch({ type: 'cleared' })
    const { request, url } = await showFile(file)
    if (!url) return
    if (phaseRef.current === 'loading') await waitForPhase()
    if (phaseRef.current !== 'ready') return

    const record: UploadRecord = {
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      blob: file,
      createdAt: stamp(),
    }
    try {
      await saveUpload(record)
      dispatch({ type: 'added', record, select: requestRef.current === request })
    } catch (error) {
      if (requestRef.current === request && isQuotaError(error)) dispatch({ type: 'quota' })
    }
  }

  function selectUpload(id: string) {
    const record = listRef.current.items.find((item) => item.id === id)
    if (!record) return
    dispatch({ type: 'selected', id })
    const file = new File([record.blob], record.name, { type: record.type })
    void showFile(file)
  }

  async function removeUpload(id: string) {
    await deleteUpload(id)
    const selected = listRef.current.selectedId === id
    dispatch({ type: 'deleted', id })
    if (!selected) return
    requestRef.current += 1
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setViewport({ status: 'empty' })
  }

  function openPicker() {
    inputRef.current?.click()
  }

  return {
    viewport,
    libraryHasItems: list.phase === 'ready' && list.items.length > 0,
    phase: list.phase,
    tiles,
    selectedId: list.selectedId,
    saveError: list.saveError,
    announcement: list.announcement,
    announcementNonce: list.announcementNonce,
    inputRef,
    openPicker,
    openFile,
    selectUpload,
    removeUpload,
  }
}
