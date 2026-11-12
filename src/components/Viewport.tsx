import { useEffect, useRef, useState } from 'react'
import './board-screen.css'
import {
  EMPTY_MESSAGE,
  LOADING_MESSAGE,
  OPENING_MESSAGE,
  VIEWPORT_HEIGHT,
  VIEWPORT_LABEL,
  VIEWPORT_WIDTH,
  contentShowsStillFrame,
  viewportColors,
  coverDrawRect,
  type ViewportState,
} from './viewportState.ts'

type ViewportProps = {
  state: ViewportState
  statusId: string
  reducedMotion?: boolean
}

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function usePrefersReducedMotion(override: boolean | undefined): boolean {
  const [reduced, setReduced] = useState(() => override ?? readPrefersReducedMotion())

  useEffect(() => {
    if (override !== undefined) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [override])

  return override ?? reduced
}

export default function Viewport({ state, statusId, reducedMotion }: ViewportProps) {
  return (
    <div
      className="viewport"
      role="img"
      aria-label={VIEWPORT_LABEL}
      aria-describedby={statusId}
      data-state={state.status}
      data-interior={state.status === 'error' ? state.interior : undefined}
      style={{
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        minWidth: VIEWPORT_WIDTH,
        minHeight: VIEWPORT_HEIGHT,
        maxWidth: VIEWPORT_WIDTH,
        maxHeight: VIEWPORT_HEIGHT,
        flexShrink: 0,
        background: viewportColors.emptyFill,
        borderRadius: 0,
      }}
    >
      <div className="viewport__interior" aria-hidden="true">
        <ViewportInterior state={state} reducedMotion={reducedMotion} />
      </div>
    </div>
  )
}

function ViewportInterior({
  state,
  reducedMotion,
}: {
  state: ViewportState
  reducedMotion?: boolean
}) {
  if (state.status === 'content') {
    return (
      <ViewportContent src={state.src} animated={state.animated} reducedMotion={reducedMotion} />
    )
  }

  if (state.status === 'loading' || state.status === 'opening') {
    const message = state.status === 'loading' ? LOADING_MESSAGE : OPENING_MESSAGE
    return (
      <div className="viewport__busy">
        <span className="viewport__spinner" style={{ width: 24, height: 24 }} />
        <p className="viewport__copy">{message}</p>
      </div>
    )
  }

  if (state.status === 'error' && state.interior === 'plain') {
    return null
  }

  return <p className="viewport__copy">{EMPTY_MESSAGE}</p>
}

function ViewportContent({
  src,
  animated,
  reducedMotion,
}: {
  src: string
  animated?: boolean
  reducedMotion?: boolean
}) {
  const prefersReducedMotion = usePrefersReducedMotion(reducedMotion)
  if (contentShowsStillFrame(src, animated, prefersReducedMotion)) {
    return <StillFrame src={src} />
  }

  return (
    <img
      className="viewport__image"
      src={src}
      alt=""
      width={VIEWPORT_WIDTH}
      height={VIEWPORT_HEIGHT}
      style={{
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        maxWidth: VIEWPORT_WIDTH,
        maxHeight: VIEWPORT_HEIGHT,
        objectFit: 'cover',
        objectPosition: 'center',
      }}
    />
  )
}

function StillFrame({ src }: { src: string }) {
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
      const rect = coverDrawRect(image.naturalWidth, image.naturalHeight)
      context.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
      context.drawImage(
        image,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        rect.dx,
        rect.dy,
        rect.dw,
        rect.dh,
      )
    }
    image.src = src

    return () => {
      cancelled = true
    }
  }, [src])

  return (
    <canvas
      ref={canvasRef}
      className="viewport__still"
      width={VIEWPORT_WIDTH}
      height={VIEWPORT_HEIGHT}
    />
  )
}
