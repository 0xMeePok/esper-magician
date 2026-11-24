import { useEffect, useRef, useState } from 'react'
import { mediaBudget } from '../flashLayout.ts'
import type { ScreenId } from '../screens.ts'
import { screenFor } from '../screens.ts'
import { activeChoice, needsCompression, type CurrentUpload } from '../useScreenContent.ts'
import type { CompressedChoice } from './choice.ts'
import { compressor } from './client.ts'
import { cropKey } from './frames.ts'
import { STRENGTHS, type StrengthId } from './strengths.ts'

export type CompressionOption = {
  strength: StrengthId
  label: string
  bytes: number
  fits: boolean
}

type Job =
  | { status: 'working'; progress: number }
  | { status: 'ready'; options: CompressionOption[]; blobs: Partial<Record<StrengthId, Blob>>; type: string }
  | { status: 'failed' }

export type CompressionState =
  | { visible: false }
  | {
      visible: true
      status: Job['status']
      progress: number
      originalBytes: number
      budget: number
      options: CompressionOption[]
      chosen: StrengthId | null
      showingOriginal: boolean
    }

/** Picks the lightest strength that fits, or keeps the previous one if it still fits. */
export function pickStrength(options: CompressionOption[], previous: StrengthId | null): StrengthId | null {
  if (previous && options.some((option) => option.strength === previous && option.fits)) return previous
  return options.find((option) => option.fits)?.strength ?? null
}

/**
 * ASH-34/35: compresses the upload on screen when it is bigger than that screen's media space,
 * and keeps the chosen strength in step with the crop.
 */
export function useCompression(
  upload: CurrentUpload | null,
  screenId: ScreenId,
  choose: (screenId: ScreenId, choice: CompressedChoice | null) => void,
) {
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [original, setOriginal] = useState<{ key: string; on: boolean }>({ key: '', on: false })
  const budget = mediaBudget(screenId)
  const needed = needsCompression(upload, screenId)
  const crop = upload?.crops[screenId] ?? null
  const key = upload && needed ? `${upload.url}|${screenId}|${cropKey(crop)}` : ''
  const job = key ? jobs[key] : undefined
  const chooseRef = useRef(choose)
  const urlRef = useRef(upload?.url ?? '')
  const started = useRef(new Set<string>())

  useEffect(() => {
    chooseRef.current = choose
    urlRef.current = upload?.url ?? ''
  })

  /** Applies a job update and forgets jobs for uploads that are no longer on screen. */
  function update(jobKey: string, next: Job) {
    setJobs((all) => {
      const kept: Record<string, Job> = {}
      for (const [id, entry] of Object.entries(all)) {
        if (id.startsWith(`${urlRef.current}|`)) kept[id] = entry
        else started.current.delete(id)
      }
      if (jobKey.startsWith(`${urlRef.current}|`)) kept[jobKey] = next
      return kept
    })
  }

  // Starts the worker for this upload, screen and crop. A changed crop is a new key, so a new job.
  useEffect(() => {
    if (!key || !upload || started.current.has(key)) return
    const jobKey = key
    started.current.add(jobKey)
    const screen = screenFor(screenId)
    void compressor()({
      file: upload.file,
      animated: upload.animated,
      screen: { width: screen.width, height: screen.height },
      crop,
      onProgress: (done) => update(jobKey, { status: 'working', progress: done }),
    }).then(
      (results) => {
        const type = upload.animated ? 'image/gif' : 'image/jpeg'
        const options = STRENGTHS.map((strength) => {
          const result = results.find((entry) => entry.strength === strength.id)
          const bytes = result?.bytes.byteLength ?? Number.POSITIVE_INFINITY
          return { strength: strength.id, label: strength.label, bytes, fits: bytes <= budget }
        })
        const blobs: Partial<Record<StrengthId, Blob>> = {}
        for (const result of results) {
          blobs[result.strength] = new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type })
        }
        update(jobKey, { status: 'ready', options, blobs, type })
      },
      () => update(jobKey, { status: 'failed' }),
    )
    // update() only reads refs, so it is safe to leave out of the dependencies.
  }, [key, upload, screenId, crop, budget])

  // Once sizes are known, keep a strength chosen that fits, and drop one that is out of date.
  const existing = upload?.compressed[screenId] ?? null
  const valid = activeChoice(upload, screenId)
  useEffect(() => {
    if (!key || job?.status !== 'ready') return
    if (valid) {
      // Restored or still current; replace only if that strength no longer fits.
      const option = job.options.find((entry) => entry.strength === valid.strength)
      if (option?.fits) return
    }
    const strength = pickStrength(job.options, existing?.strength ?? null)
    const blob = strength ? job.blobs[strength] : undefined
    if (strength && blob) {
      chooseRef.current(screenId, { strength, cropKey: cropKey(crop), type: job.type, blob })
    } else if (existing) {
      chooseRef.current(screenId, null)
    }
  }, [key, job, valid, existing, screenId, crop])

  function select(strength: StrengthId) {
    if (job?.status !== 'ready' || !upload) return
    const option = job.options.find((entry) => entry.strength === strength)
    const blob = job.blobs[strength]
    if (!option?.fits || !blob) return
    choose(screenId, { strength, cropKey: cropKey(crop), type: job.type, blob })
    setOriginal({ key, on: false })
  }

  const showingOriginal = original.key === key && original.on

  const state: CompressionState =
    !needed || !upload
      ? { visible: false }
      : {
          visible: true,
          status: job?.status ?? 'working',
          progress: job?.status === 'working' ? job.progress : job ? 1 : 0,
          originalBytes: upload.bytes,
          budget,
          options: job?.status === 'ready' ? job.options : [],
          chosen: valid?.strength ?? null,
          showingOriginal,
        }

  return {
    state,
    select,
    toggleOriginal: () => setOriginal({ key, on: !showingOriginal }),
  }
}
