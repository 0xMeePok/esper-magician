import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { coverDrawRect } from './viewportState.ts'
import { ON_THE_SCREEN, SELECTED } from '../examples.ts'
import type { ItemStatus } from '../flash/onScreen.ts'
import {
  UNAVAILABLE_MESSAGE,
  focusAfterDelete,
  moveTileIndex,
  tileLabel,
  type UploadTile,
} from '../uploadList.ts'

const THUMB_WIDTH = 104
const THUMB_HEIGHT = 78

type MyUploadsSectionProps = {
  phase: 'loading' | 'ready' | 'unavailable'
  tiles: UploadTile[]
  selectedId: string | null
  /** How each upload is marked: on the screen, selected to send, or neither. */
  statusFor: (id: string) => ItemStatus
  saveError: string | null
  announcement: string
  announcementNonce: number
  onOpenPicker: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<void>
}

export default function MyUploadsSection({
  phase,
  tiles,
  selectedId,
  statusFor,
  saveError,
  announcement,
  announcementNonce,
  onOpenPicker,
  onSelect,
  onDelete,
}: MyUploadsSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([])
  const removeRefs = useRef<Array<HTMLButtonElement | null>>([])
  const keepRef = useRef<HTMLButtonElement>(null)
  const confirmRemoveRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<
    { kind: 'remove'; index: number } | { kind: 'tile'; index: number } | { kind: 'heading' } | null
  >(null)
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [trackedSelection, setTrackedSelection] = useState(selectedId)
  const titleId = useId()
  const bodyId = useId()
  const selectedIndex = tiles.findIndex((tile) => tile.id === selectedId)
  if (selectedId !== trackedSelection) {
    setTrackedSelection(selectedId)
    if (selectedIndex >= 0) setActiveIndex(selectedIndex)
  }
  const tabStop = tiles.length === 0 ? 0 : Math.min(activeIndex, tiles.length - 1)
  const live = announcement
    ? announcementNonce % 2 === 0
      ? `${announcement}\u200b`
      : announcement
    : ''

  useEffect(() => {
    if (confirmIndex !== null || pendingFocus.current === null) return
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target.kind === 'heading') {
      headingRef.current?.focus()
      return
    }
    if (target.kind === 'remove') {
      removeRefs.current[target.index]?.focus()
      return
    }
    tileRefs.current[target.index]?.focus()
  }, [confirmIndex, tiles])

  const closeConfirm = useCallback(() => {
    setConfirmIndex((current) => {
      if (current === null) return current
      pendingFocus.current = { kind: 'remove', index: current }
      return null
    })
  }, [])

  useEffect(() => {
    if (confirmIndex === null) return
    keepRef.current?.focus()

    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeConfirm()
        return
      }
      if (event.key !== 'Tab') return
      const first = keepRef.current
      const last = confirmRemoveRef.current
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeConfirm, confirmIndex])

  function onTileKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      setConfirmIndex(index)
      return
    }
    const next = moveTileIndex(index, tiles.length, event.key)
    if (next === null) return
    event.preventDefault()
    setActiveIndex(next)
    tileRefs.current[next]?.focus()
  }

  async function confirmDelete() {
    if (confirmIndex === null) return
    const tile = tiles[confirmIndex]
    if (!tile) return
    const next = focusAfterDelete(confirmIndex, tiles.length - 1)
    if (next !== 'heading') setActiveIndex(next)
    await onDelete(tile.id)
    pendingFocus.current = next === 'heading' ? { kind: 'heading' } : { kind: 'tile', index: next }
    setConfirmIndex(null)
  }

  const confirming = confirmIndex === null ? null : tiles[confirmIndex]

  return (
    <section className="panel" aria-labelledby="my-uploads-heading">
      <h2 id="my-uploads-heading" ref={headingRef} tabIndex={-1}>
        My uploads
      </h2>
      <div className="uploads-body">
        <p className="helper">Saved on this device only. Clearing your browser data removes them.</p>
        {phase === 'unavailable' ? <p className="upload-banner">{UNAVAILABLE_MESSAGE}</p> : null}
        {saveError ? <p className="upload-error">{saveError}</p> : null}
        {phase === 'loading' ? (
          <div className="upload-grid" aria-hidden="true">
            <div className="upload-skeleton" />
            <div className="upload-skeleton" />
            <div className="upload-skeleton" />
          </div>
        ) : null}
        {phase !== 'loading' && tiles.length === 0 ? (
          <div className="upload-empty">
            <p className="upload-empty-title">No uploads yet.</p>
            {phase === 'ready' ? (
              <p className="helper">Pictures and GIFs you upload will be saved here.</p>
            ) : null}
            <button type="button" className="button button-file" onClick={onOpenPicker}>
              Upload a picture or animation
            </button>
          </div>
        ) : null}
        {tiles.length > 0 ? (
          <ul className={tiles.length > 12 ? 'upload-grid upload-grid-scroll' : 'upload-grid'}>
            {tiles.map((tile, index) => {
              const selected = tile.id === selectedId
              const status = statusFor(tile.id)
              return (
                <li className="upload-item" key={tile.id}>
                  <button
                    type="button"
                    className="upload-tile"
                    ref={(node) => {
                      tileRefs.current[index] = node
                    }}
                    tabIndex={index === tabStop ? 0 : -1}
                    aria-pressed={selected}
                    aria-label={tileLabel(tile.name, tile.type, status)}
                    title={tile.name}
                    onClick={() => onSelect(tile.id)}
                    onKeyDown={(event) => onTileKeyDown(event, index)}
                  >
                    <span className="upload-thumb">
                      {tile.animated ? <GifThumb src={tile.src} /> : <img src={tile.src} alt="" />}
                      {tile.animated ? <span className="upload-gif-badge">GIF</span> : null}
                      {status === 'on-screen' ? (
                        <span className="upload-scrim">
                          <span className="upload-check" aria-hidden="true">
                            ✓
                          </span>
                          <span className="upload-on-screen">{ON_THE_SCREEN}</span>
                        </span>
                      ) : null}
                      {status === 'selected' ? (
                        <span className="upload-scrim upload-scrim--selected">
                          <span className="upload-on-screen">{SELECTED}</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="upload-name">{tile.name}</span>
                  </button>
                  <button
                    type="button"
                    className="upload-remove"
                    ref={(node) => {
                      removeRefs.current[index] = node
                    }}
                    tabIndex={index === tabStop ? 0 : -1}
                    aria-label={`Remove ${tile.name}`}
                    onClick={() => setConfirmIndex(index)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Delete' && event.key !== 'Backspace') return
                      event.preventDefault()
                      setConfirmIndex(index)
                    }}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>
      {confirming ? (
        <div
          className="upload-overlay"
          onClick={closeConfirm}
        >
          <div
            className="upload-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={titleId}>Remove this upload?</h3>
            <p id={bodyId}>It will be deleted from this device.</p>
            <div className="upload-dialog-actions">
              <button
                type="button"
                className="button button-file"
                ref={keepRef}
                onClick={closeConfirm}
              >
                Keep
              </button>
              <button
                type="button"
                className="button button-danger"
                ref={confirmRemoveRef}
                onClick={() => void confirmDelete()}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function GifThumb({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const context = canvas.getContext('2d')
      if (!context) return
      const rect = coverDrawRect(image.naturalWidth, image.naturalHeight, THUMB_WIDTH, THUMB_HEIGHT)
      context.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT)
      context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)
    }
    image.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  return <canvas ref={canvasRef} width={THUMB_WIDTH} height={THUMB_HEIGHT} />
}
