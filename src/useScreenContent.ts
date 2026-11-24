import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { withChoice, type CompressedChoice, type CompressedChoices } from './compress/choice.ts'
import { cropKey } from './compress/frames.ts'
import type { StrengthId } from './compress/strengths.ts'
import { withScreenCrop, type ScreenCrop, type ScreenCrops, type Size } from './crop.ts'
import { mediaBudget } from './flashLayout.ts'
import { exampleById } from './examples.ts'
import { keepsCurrentExample, showExample, showUpload } from './preview.ts'
import { screenFor, type ScreenId } from './screens.ts'
import type { OpenedMedia } from './upload.ts'
import { isAnimatedMedia } from './upload.ts'
import { initialUploadListState, uploadListReducer, type UploadTile } from './uploadList.ts'
import {
  deleteUpload,
  isQuotaError,
  listUploads,
  openLibrary,
  saveUpload,
  type UploadRecord,
} from './uploadsDb.ts'
import type { ViewportState } from './components/viewportState.ts'

/** The upload that is on the screen right now, saved or not. */
export type CurrentUpload = {
  /** The library record id, or null for an unsaved session preview. */
  savedId: string | null
  name: string
  animated: boolean
  /** Object URL of the original file. Crops never change these bytes. */
  url: string
  source: Size
  crops: ScreenCrops
  /** The original file and its size, which decides whether it needs compressing (ASH-34). */
  file: Blob
  bytes: number
  /** Per-screen compressed copies (ASH-35). */
  compressed: CompressedChoices
}

/** What ASH-19 flashes for a screen. Null when there is nothing to flash yet. */
export type ScreenAsset =
  | { kind: 'example'; id: string }
  | { kind: 'upload'; name: string; type: string; blob: Blob; compressed: StrengthId | null }

/** The compressed copy for a screen, if it was made with that screen's current crop. */
export function activeChoice(
  current: CurrentUpload | null,
  screenId: ScreenId,
): CompressedChoice | null {
  const choice = current?.compressed[screenId]
  if (!current || !choice) return null
  return choice.cropKey === cropKey(current.crops[screenId]) ? choice : null
}

export function needsCompression(current: CurrentUpload | null, screenId: ScreenId): boolean {
  return current !== null && current.bytes > mediaBudget(screenId)
}

export function cropAnnouncement(screenId: ScreenId, applied: boolean): string {
  const name = screenFor(screenId).title
  return applied ? `Crop applied for the ${name}.` : `Crop removed for the ${name}.`
}

/** The viewport for one screen: the shared state plus that screen's saved crop, if any. */
export function viewportForScreen(
  state: ViewportState,
  current: CurrentUpload | null,
  screenId: ScreenId,
): ViewportState {
  if (state.status !== 'content' || !current || state.src !== current.url) return state
  const crop = current.crops[screenId]
  if (!crop) return state
  return { ...state, crop: { ...crop, source: current.source } }
}

export function useScreenContent() {
  const [list, dispatch] = useReducer(uploadListReducer, initialUploadListState)
  const [viewport, setViewport] = useState<ViewportState>({ status: 'empty' })
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(null)
  const [current, setCurrent] = useState<CurrentUpload | null>(null)
  const [cropMessage, setCropMessage] = useState({ text: '', nonce: 0 })

  const listRef = useRef(list)
  const phaseRef = useRef(list.phase)
  const viewportRef = useRef(viewport)
  const exampleRef = useRef(selectedExampleId)
  const currentRef = useRef(current)
  const urlRef = useRef<string | null>(null)
  const requestRef = useRef(0)
  const clockRef = useRef(0)
  const waitsRef = useRef<number[]>([])
  const thumbUrls = useRef(new Map<string, { blob: Blob; url: string }>())
  const choiceUrls = useRef(new Map<Blob, string>())

  useEffect(() => {
    listRef.current = list
    phaseRef.current = list.phase
  }, [list])

  function setCurrentUpload(next: CurrentUpload | null) {
    currentRef.current = next
    setCurrent(next)
  }

  function commit(request: number, exampleId: string | null, next: ViewportState) {
    if (requestRef.current !== request) return
    if (next.status === 'content' && next.src.startsWith('blob:')) urlRef.current = next.src
    viewportRef.current = next
    exampleRef.current = exampleId
    setViewport(next)
    setSelectedExampleId(exampleId)
  }

  const tiles = useMemo<UploadTile[]>(() => {
    const cache = thumbUrls.current
    return list.items.map((item) => {
      let cached = cache.get(item.id)
      if (!cached || cached.blob !== item.blob) {
        if (cached) URL.revokeObjectURL(cached.url)
        cached = { blob: item.blob, url: URL.createObjectURL(item.blob) }
        cache.set(item.id, cached)
      }
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        animated: isAnimatedMedia(item.name, item.type),
        src: cached.url,
      }
    })
  }, [list.items])

  useEffect(() => {
    const cache = thumbUrls.current
    const ids = new Set(list.items.map((item) => item.id))
    for (const [id, entry] of cache) {
      if (ids.has(id)) continue
      URL.revokeObjectURL(entry.url)
      cache.delete(id)
    }
  }, [list.items])

  useEffect(() => {
    const keep = new Set(Object.values(current?.compressed ?? {}).map((choice) => choice?.blob))
    for (const [blob, url] of choiceUrls.current) {
      if (keep.has(blob)) continue
      URL.revokeObjectURL(url)
      choiceUrls.current.delete(blob)
    }
  }, [current])

  function urlFor(blob: Blob): string {
    let url = choiceUrls.current.get(blob)
    if (!url) {
      url = URL.createObjectURL(blob)
      choiceUrls.current.set(blob, url)
    }
    return url
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const opened = await openLibrary()
      if (cancelled) return
      if (!opened.ok) {
        dispatch({ type: 'unavailable' })
        return
      }
      try {
        const items = await listUploads()
        if (cancelled) return
        dispatch({ type: 'loaded', items })
      } catch {
        if (!cancelled) dispatch({ type: 'unavailable' })
      }
    })()

    const request = requestRef
    const url = urlRef
    const waits = waitsRef
    const cache = thumbUrls.current
    const choices = choiceUrls.current
    return () => {
      cancelled = true
      request.current += 1
      const src = url.current
      if (src) URL.revokeObjectURL(src)
      for (const id of waits.current) window.clearInterval(id)
      for (const entry of cache.values()) URL.revokeObjectURL(entry.url)
      cache.clear()
      for (const url of choices.values()) URL.revokeObjectURL(url)
      choices.clear()
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

  /** Shows a file and remembers it as the current upload once it decodes. */
  async function showFile(
    file: File,
    savedId: string | null,
    crops: ScreenCrops,
    compressed: CompressedChoices,
  ): Promise<{ request: number; url: string | null }> {
    const request = ++requestRef.current
    const previous = urlRef.current
    urlRef.current = null
    setCurrentUpload(null)

    const onOpened = (media: OpenedMedia) => {
      if (requestRef.current !== request) return
      setCurrentUpload({
        savedId,
        name: file.name,
        animated: media.animated,
        url: media.url,
        source: { width: media.width, height: media.height },
        crops,
        file,
        bytes: file.size,
        compressed,
      })
    }
    const url = await showUpload(
      file,
      previous,
      (exampleId, next) => commit(request, exampleId, next),
      onOpened,
    )
    if (requestRef.current !== request && url) URL.revokeObjectURL(url)
    return { request, url }
  }

  async function openFile(file: File) {
    dispatch({ type: 'cleared' })
    const { request, url } = await showFile(file, null, {}, {})
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
      const stillShowing = requestRef.current === request
      dispatch({ type: 'added', record, select: stillShowing })
      const showing = currentRef.current
      if (stillShowing && showing && showing.url === url) {
        // Crops and compressed copies made before the save finished go along with the record.
        const saved = { ...record, crops: showing.crops, compressed: showing.compressed }
        setCurrentUpload({ ...showing, savedId: record.id })
        const edits = Object.keys(showing.crops).length + Object.keys(showing.compressed).length
        if (edits > 0) void persistRecord(saved)
      }
    } catch (error) {
      if (requestRef.current === request && isQuotaError(error)) dispatch({ type: 'quota' })
    }
  }

  function selectUpload(id: string) {
    const record = listRef.current.items.find((item) => item.id === id)
    if (!record) return
    dispatch({ type: 'selected', id })
    const file = new File([record.blob], record.name, { type: record.type })
    void showFile(file, record.id, record.crops ?? {}, record.compressed ?? {})
  }

  function selectExample(id: string) {
    if (!exampleById(id)) return
    if (keepsCurrentExample(exampleRef.current, viewportRef.current, id)) return

    const request = ++requestRef.current
    const previous = urlRef.current
    urlRef.current = null
    dispatch({ type: 'cleared' })
    setCurrentUpload(null)

    void showExample(id, previous, (exampleId, next) => {
      commit(request, exampleId, next)
    })
  }

  async function removeUpload(id: string) {
    await deleteUpload(id)
    const selected = listRef.current.selectedId === id
    const showing = currentRef.current?.savedId === id
    dispatch({ type: 'deleted', id })
    if (!selected && !showing) return
    requestRef.current += 1
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setCurrentUpload(null)
    viewportRef.current = { status: 'empty' }
    setViewport({ status: 'empty' })
  }

  async function persistRecord(record: UploadRecord) {
    try {
      await saveUpload(record)
      dispatch({ type: 'updated', record })
    } catch {
      // The edit still applies for this visit; it just won't survive a reload.
    }
  }

  /** Saves (or with null, removes) the crop for one screen on the upload that is showing. */
  function applyCrop(screenId: ScreenId, crop: ScreenCrop | null) {
    const showing = currentRef.current
    if (!showing) return
    const crops = withScreenCrop(showing.crops, screenId, crop)
    setCurrentUpload({ ...showing, crops })
    setCropMessage((message) => ({
      text: cropAnnouncement(screenId, crop !== null),
      nonce: message.nonce + 1,
    }))

    if (!showing.savedId) return
    const record = listRef.current.items.find((item) => item.id === showing.savedId)
    if (!record) return
    void persistRecord({ ...record, crops, compressed: showing.compressed })
  }

  /** ASH-35: keeps (or with null, drops) the compressed copy for one screen. */
  function chooseCompression(screenId: ScreenId, choice: CompressedChoice | null) {
    const showing = currentRef.current
    if (!showing) return
    const compressed = withChoice(showing.compressed, screenId, choice)
    setCurrentUpload({ ...showing, compressed })
    if (!showing.savedId) return
    const record = listRef.current.items.find((item) => item.id === showing.savedId)
    if (!record) return
    void persistRecord({ ...record, crops: showing.crops, compressed })
  }

  /** The screen preview. With `original`, a compressed copy is ignored (the compare toggle). */
  function viewportFor(screenId: ScreenId, original = false): ViewportState {
    const base = viewportForScreen(viewport, current, screenId)
    const showing = viewport.status === 'content' && current && viewport.src === current.url
    const choice = showing && !original ? activeChoice(current, screenId) : null
    if (!choice) return base
    // Already turned, cropped and scaled to the screen, so no crop is applied again.
    return { status: 'content', src: urlFor(choice.blob), animated: choice.type === 'image/gif' }
  }

  /** ASH-35: exactly what ASH-19 will flash for a screen. */
  function assetFor(screenId: ScreenId): ScreenAsset | null {
    if (selectedExampleId && viewport.status !== 'loading') {
      return { kind: 'example', id: selectedExampleId }
    }
    const showing = viewport.status === 'content' && current && viewport.src === current.url
    if (!showing || !current) return null
    if (!needsCompression(current, screenId)) {
      const type = current.file.type
      return { kind: 'upload', name: current.name, type, blob: current.file, compressed: null }
    }
    const choice = activeChoice(current, screenId)
    if (!choice) return null
    return { kind: 'upload', name: current.name, type: choice.type, blob: choice.blob, compressed: choice.strength }
  }

  const canCrop =
    viewport.status === 'content' && current !== null && viewport.src === current.url

  return {
    viewport,
    viewportFor,
    assetFor,
    selectedExampleId,
    current: canCrop ? current : null,
    canCrop,
    cropMessage,
    libraryHasItems: list.phase === 'ready' && list.items.length > 0,
    phase: list.phase,
    tiles,
    selectedId: list.selectedId,
    saveError: list.saveError,
    announcement: list.announcement,
    announcementNonce: list.announcementNonce,
    openFile,
    selectUpload,
    selectExample,
    removeUpload,
    applyCrop,
    chooseCompression,
  }
}
