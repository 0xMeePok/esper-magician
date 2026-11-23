import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  describeCrop,
  drawLayout,
  fitRotated,
  initialCrop,
  moveRect,
  resizeAroundCenter,
  resizeFromCorner,
  rotateCrop,
  rotatedSize,
  type Corner,
  type CropRect,
  type ScreenCrop,
  type Size,
} from '../crop.ts'
import {
  EDITOR_COPY,
  editorTitle,
  lockedShapeLabel,
  rotatedAnnouncement,
} from '../cropCopy.ts'
import { decodeImage } from '../upload.ts'
import type { Screen } from '../screens.ts'
import Viewport from './Viewport.tsx'
import './crop-editor.css'
import type { ViewportState } from './viewportState.ts'

export type CropMedia = {
  url: string
  name: string
  animated: boolean
  source: Size
}

type CropEditorProps = {
  screen: Screen
  media: CropMedia
  saved: ScreenCrop | null
  onApply: (crop: ScreenCrop | null) => void
  onCancel: () => void
  /** Test hook: skip decoding and treat the source as readable (or not). */
  decoded?: boolean
}

type Drag =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; start: CropRect }
  | { kind: 'resize'; pointerId: number; corner: Corner; start: CropRect }

const WORK_PADDING = 16
const DEFAULT_WORK_BOX: Size = { width: 560, height: 420 }
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex="0"], a[href], input:not([disabled])',
    ),
  ].filter((element) => !element.hasAttribute('inert'))
}

export default function CropEditor({
  screen,
  media,
  saved,
  onApply,
  onCancel,
  decoded,
}: CropEditorProps) {
  const titleId = useId()
  const hintId = useId()
  const liveId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<Drag | null>(null)

  const [crop, setCrop] = useState<ScreenCrop>(() => saved ?? initialCrop(media.source, screen))
  const [adjusted, setAdjusted] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(() =>
    decoded === undefined ? 'loading' : decoded ? 'ready' : 'error',
  )
  const [live, setLive] = useState('')
  const [workBox, setWorkBox] = useState<Size>(DEFAULT_WORK_BOX)

  const bounds = rotatedSize(media.source.width, media.source.height, crop.rotationDeg)
  const inner: Size = {
    width: Math.max(1, workBox.width - WORK_PADDING * 2),
    height: Math.max(1, workBox.height - WORK_PADDING * 2),
  }
  const fit = fitRotated(media.source, crop.rotationDeg, inner)
  const scale = fit.scale
  const stage: Size = { width: bounds.width * scale, height: bounds.height * scale }
  const stageLeft = WORK_PADDING + (inner.width - stage.width) / 2
  const stageTop = WORK_PADDING + (inner.height - stage.height) / 2
  const box = {
    left: crop.cropRect.x * scale,
    top: crop.cropRect.y * scale,
    width: crop.cropRect.width * scale,
    height: crop.cropRect.height * scale,
  }
  const usable = status === 'ready'

  // Decode the original (the first frame for a GIF) for the work area.
  useEffect(() => {
    if (decoded !== undefined) return
    let cancelled = false
    void decodeImage(media.url).then((size) => {
      if (cancelled) return
      if (!size || size.width <= 0 || size.height <= 0) {
        setStatus('error')
        return
      }
      const image = new Image()
      image.onload = () => {
        if (cancelled) return
        imageRef.current = image
        setStatus('ready')
      }
      image.onerror = () => {
        if (!cancelled) setStatus('error')
      }
      image.src = media.url
    })
    return () => {
      cancelled = true
    }
  }, [decoded, media.url])

  // Track the work area's size so the image always fits inside its padding.
  useLayoutEffect(() => {
    const work = workRef.current
    if (!work) return
    const measure = () => {
      const width = work.clientWidth
      const height = work.clientHeight
      if (width > 0 && height > 0) setWorkBox({ width, height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(work)
    return () => observer.disconnect()
  }, [])

  // Paint the rotated original into the work area.
  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image || status !== 'ready') return
    const ratio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.max(1, Math.round(stage.width * ratio))
    canvas.height = Math.max(1, Math.round(stage.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, stage.width, stage.height)
    drawLayout(context, image, {
      left: (stage.width - fit.width) / 2,
      top: (stage.height - fit.height) / 2,
      width: fit.width,
      height: fit.height,
      rotation: crop.rotationDeg,
    })
  }, [status, stage.width, stage.height, fit.width, fit.height, crop.rotationDeg])

  // Open: move focus into the dialog and stop the page behind it from scrolling.
  useEffect(() => {
    titleRef.current?.focus()
    const body = document.body
    const previous = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = previous
    }
  }, [])

  const cancel = useCallback(() => onCancel(), [onCancel])

  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const items = focusableIn(dialog)
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function update(next: CropRect, announce: boolean) {
    setCrop((value) => ({ ...value, cropRect: next }))
    setAdjusted(true)
    setCleared(false)
    if (announce) setLive(describeCrop(next, bounds))
  }

  function rotate(direction: 1 | -1) {
    const next = rotateCrop(crop, direction, media.source, screen, adjusted)
    setCrop(next)
    setCleared(false)
    setLive(rotatedAnnouncement(next.rotationDeg))
  }

  function reset() {
    setCrop(initialCrop(media.source, screen))
    setAdjusted(false)
    setCleared(true)
  }

  function sourcePoint(clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect()
    return {
      x: (clientX - (rect?.left ?? 0)) / scale,
      y: (clientY - (rect?.top ?? 0)) / scale,
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!usable || event.button !== 0) return
    const target = event.target instanceof HTMLElement ? event.target : null
    const corner = target?.closest<HTMLElement>('[data-corner]')?.dataset.corner as
      | Corner
      | undefined
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = corner
      ? { kind: 'resize', pointerId: event.pointerId, corner, start: crop.cropRect }
      : {
          kind: 'move',
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          start: crop.cropRect,
        }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    if (drag.kind === 'move') {
      const dx = (event.clientX - drag.startX) / scale
      const dy = (event.clientY - drag.startY) / scale
      update(moveRect(drag.start, dx, dy, bounds), false)
      return
    }
    const point = sourcePoint(event.clientX, event.clientY)
    update(resizeFromCorner(drag.start, drag.corner, point, bounds, screen), false)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setLive(describeCrop(crop.cropRect, bounds))
  }

  function onCropKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!usable) return
    const step = (event.shiftKey ? 10 : 1) / scale
    const grow = 10 / scale
    const key = event.key
    let next: CropRect | null = null

    if (key === '+' || key === '=' || (event.altKey && (key === 'ArrowUp' || key === 'ArrowRight'))) {
      next = resizeAroundCenter(crop.cropRect, grow, bounds, screen)
    } else if (
      key === '-' ||
      key === '_' ||
      (event.altKey && (key === 'ArrowDown' || key === 'ArrowLeft'))
    ) {
      next = resizeAroundCenter(crop.cropRect, -grow, bounds, screen)
    } else if (key === 'ArrowLeft') {
      next = moveRect(crop.cropRect, -step, 0, bounds)
    } else if (key === 'ArrowRight') {
      next = moveRect(crop.cropRect, step, 0, bounds)
    } else if (key === 'ArrowUp') {
      next = moveRect(crop.cropRect, 0, -step, bounds)
    } else if (key === 'ArrowDown') {
      next = moveRect(crop.cropRect, 0, step, bounds)
    }

    if (!next) return
    event.preventDefault()
    update(next, true)
  }

  const previewState: ViewportState = cleared
    ? { status: 'content', src: media.url, animated: media.animated }
    : {
        status: 'content',
        src: media.url,
        animated: media.animated,
        crop: { ...crop, source: media.source },
      }

  return (
    <div className="crop-backdrop">
      <div
        ref={dialogRef}
        className="crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
      >
        <header className="crop-dialog__header">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="crop-dialog__title">
            {editorTitle(screen)}
          </h2>
          <span className="crop-chip" data-locked="true">
            <LockIcon />
            {lockedShapeLabel(screen)}
          </span>
        </header>

        <div className="crop-dialog__body">
          <div className="crop-dialog__edit">
            <div ref={workRef} className="crop-work">
              {status === 'error' ? (
                <p className="crop-error" role="alert">
                  {EDITOR_COPY.decodeError}
                </p>
              ) : (
                <div
                  ref={stageRef}
                  className="crop-stage"
                  style={{
                    left: stageLeft,
                    top: stageTop,
                    width: stage.width,
                    height: stage.height,
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    className="crop-canvas"
                    style={{ width: stage.width, height: stage.height }}
                  />
                  <div className="crop-shade" aria-hidden="true">
                    <div
                      className="crop-shade__window"
                      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                    />
                  </div>
                  {usable ? (
                    <div
                      className="crop-box"
                      role="group"
                      tabIndex={0}
                      aria-roledescription="adjustable crop area"
                      aria-label={EDITOR_COPY.cropArea}
                      aria-describedby={liveId}
                      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onKeyDown={onCropKeyDown}
                    >
                      <span className="crop-box__thirds" aria-hidden="true" />
                      {CORNERS.map((corner) => (
                        <span
                          key={corner}
                          className={`crop-handle crop-handle--${corner}`}
                          data-corner={corner}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {media.animated ? <p className="helper crop-gif-caption">{EDITOR_COPY.gifCaption}</p> : null}
            <div className="crop-toolbar">
              <div className="crop-toolbar__rotate">
                <button
                  type="button"
                  className="button button-file"
                  aria-label={EDITOR_COPY.rotateLeftLabel}
                  disabled={!usable}
                  onClick={() => rotate(-1)}
                >
                  {EDITOR_COPY.rotateLeft}
                </button>
                <button
                  type="button"
                  className="button button-file"
                  aria-label={EDITOR_COPY.rotateRightLabel}
                  disabled={!usable}
                  onClick={() => rotate(1)}
                >
                  {EDITOR_COPY.rotateRight}
                </button>
                {crop.rotationDeg !== 0 && !cleared ? (
                  <span className="crop-toolbar__angle">Rotated {crop.rotationDeg}°</span>
                ) : null}
              </div>
              <button
                type="button"
                className="button button-text"
                disabled={!usable}
                onClick={reset}
              >
                {EDITOR_COPY.reset}
              </button>
            </div>
          </div>

          <div className="crop-dialog__preview">
            <div className="crop-preview__heading">
              <span className="crop-preview__label">{EDITOR_COPY.preview}</span>
              <span id={hintId} className="crop-preview__hint">
                {screen.width} × {screen.height}
              </span>
            </div>
            <div className="crop-preview__scroll">
              <div className="bezel crop-preview__bezel">
                <div
                  className="bezel-opening"
                  style={{
                    width: screen.width,
                    height: screen.height,
                    minWidth: screen.width,
                    minHeight: screen.height,
                  }}
                >
                  {usable ? (
                    <Viewport
                      state={previewState}
                      statusId={hintId}
                      width={screen.width}
                      height={screen.height}
                    />
                  ) : (
                    <Viewport
                      state={{ status: 'error', message: EDITOR_COPY.decodeError, interior: 'plain' }}
                      statusId={hintId}
                      width={screen.width}
                      height={screen.height}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="crop-dialog__footer">
          <button type="button" className="button button-file" onClick={cancel}>
            {EDITOR_COPY.cancel}
          </button>
          <button
            type="button"
            className="button"
            disabled={!usable}
            onClick={() => onApply(cleared ? null : crop)}
          >
            {EDITOR_COPY.apply}
          </button>
        </footer>

        <p id={liveId} className="visually-hidden" aria-live="polite">
          {live}
        </p>
      </div>
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.2" fill="currentColor" />
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
