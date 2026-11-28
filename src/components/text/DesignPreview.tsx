import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { designSize, MIN_BOX, type Box, type Design } from '../../text/design.ts'
import { apply, invert, layerMatrix, type Matrix } from '../../text/geometry.ts'
import { drawBackground, drawSprites, gifFrameAt, layerRotation, makeCanvas, type BuiltScene, type Canvas2D } from '../../text/render.ts'

type Props = {
  design: Design
  built: BuiltScene | null
  /** Screen pixels to CSS pixels. */
  scale: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, box: Partial<Box>) => void
  label: string
}

const HANDLE = 7 // CSS pixels, half the resize handle's size

type Drag = {
  id: string
  mode: 'move' | 'resize'
  start: { x: number; y: number }
  box: Box
  rotation: number
}

/**
 * The design as the screen will show it, playing: drawn from the same sprites and timings the
 * screen gets, so moving and blinking match. Drag a layer to move it, its corner to resize it.
 */
export default function DesignPreview({ design, built, scale, selectedId, onSelect, onMove, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const size = designSize(design.orientation, built?.device ?? { width: 170, height: 320 })
  // The animation reads the latest props without restarting.
  const latest = useRef({ design, built, selectedId, scale })
  useLayoutEffect(() => {
    latest.current = { design, built, selectedId, scale }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let frame = 0
    const start = performance.now()
    let screen: Canvas2D | null = null
    let backgrounds = new Map<number, Canvas2D>()
    let backgroundsFor: BuiltScene | null = null

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const { design, built, selectedId, scale } = latest.current
      const ratio = window.devicePixelRatio || 1
      const view = designSize(design.orientation, built?.device ?? { width: 170, height: 320 })
      const width = Math.round(view.width * scale * ratio)
      const height = Math.round(view.height * scale * ratio)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = design.background
      ctx.fillRect(0, 0, width, height)
      if (built) {
        const t = performance.now() - start
        if (backgroundsFor !== built) {
          backgrounds = new Map()
          backgroundsFor = built
        }
        const index = gifFrameAt(built, t)
        let background = backgrounds.get(index)
        if (!background) {
          background = drawBackground(built, index)
          backgrounds.set(index, background)
        }
        screen ??= makeCanvas(built.device.width, built.device.height)
        const sctx = screen.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
        sctx.setTransform(1, 0, 0, 1, 0, 0)
        sctx.drawImage(background, 0, 0)
        drawSprites(sctx, built, t)
        // Back from the screen's pixels to the design the way it's held, each pixel a crisp square.
        const [a, b, c, d, e, f] = invert(built.orient)
        const k = scale * ratio
        ctx.imageSmoothingEnabled = false
        ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k)
        ctx.drawImage(screen, 0, 0)
      }
      const layer = design.layers.find((item) => item.id === selectedId)
      if (layer) outline(ctx, layerMatrix(layer, layerRotation(layer)), layer, scale * ratio)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  /** A pointer position in design pixels. */
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * size.width, y: ((event.clientY - rect.top) / rect.height) * size.height }
  }

  function local(m: Matrix, p: { x: number; y: number }) {
    return apply(invert(m), p.x, p.y)
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const p = point(event)
    const selected = design.layers.find((layer) => layer.id === selectedId)
    if (selected) {
      const m = layerMatrix(selected, layerRotation(selected))
      const corner = apply(m, selected.width, selected.height)
      if (Math.hypot(corner.x - p.x, corner.y - p.y) <= (HANDLE * 1.6) / scale) {
        drag.current = { id: selected.id, mode: 'resize', start: p, box: { ...selected }, rotation: layerRotation(selected) }
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
    }
    const hit = [...design.layers].reverse().find((layer) => {
      const q = local(layerMatrix(layer, layerRotation(layer)), p)
      return q.x >= 0 && q.y >= 0 && q.x <= layer.width && q.y <= layer.height
    })
    onSelect(hit?.id ?? null)
    if (hit) {
      drag.current = { id: hit.id, mode: 'move', start: p, box: { ...hit }, rotation: layerRotation(hit) }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag.current
    if (!current) return
    const p = point(event)
    const dx = p.x - current.start.x
    const dy = p.y - current.start.y
    if (current.mode === 'move') {
      onMove(current.id, { x: Math.round(current.box.x + dx), y: Math.round(current.box.y + dy) })
      return
    }
    // Resize along the layer's own axes, however it is turned.
    const radians = (current.rotation * Math.PI) / 180
    const along = dx * Math.cos(radians) + dy * Math.sin(radians)
    const across = -dx * Math.sin(radians) + dy * Math.cos(radians)
    onMove(current.id, {
      width: Math.max(MIN_BOX, Math.round(current.box.width + along)),
      height: Math.max(MIN_BOX, Math.round(current.box.height + across)),
    })
  }

  function onPointerUp() {
    drag.current = null
  }

  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const layer = design.layers.find((item) => item.id === selectedId)
    const step = event.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (!layer || !move) return
    event.preventDefault()
    onMove(layer.id, { x: layer.x + move[0], y: layer.y + move[1] })
  }

  return (
    <canvas
      ref={canvasRef}
      className="design-preview__canvas"
      // The backlight dims everything on the screen alike.
      style={{ width: size.width * scale, height: size.height * scale, filter: design.brightness < 100 ? `brightness(${design.brightness / 100})` : undefined }}
      role="img"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}

/** The selected layer's box, dashed, with a resize handle at its far corner. */
function outline(ctx: CanvasRenderingContext2D, m: Matrix, box: Box, k: number) {
  const corners = [apply(m, 0, 0), apply(m, box.width, 0), apply(m, box.width, box.height), apply(m, 0, box.height)]
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.lineWidth = 1.5 / k
  ctx.beginPath()
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.stroke()
  ctx.setLineDash([5 / k, 4 / k])
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.setLineDash([])
  const handle = corners[2]!
  const r = (HANDLE * 2) / (k / (window.devicePixelRatio || 1))
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#0f766e'
  ctx.lineWidth = 2 / k
  ctx.fillRect(handle.x - r / 2, handle.y - r / 2, r, r)
  ctx.strokeRect(handle.x - r / 2, handle.y - r / 2, r, r)
}
