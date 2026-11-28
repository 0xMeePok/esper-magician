import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { FlashSource } from '../../flash/deviceAsset.ts'
import { SCENE_PLAYER_VERSION, SCENE_TYPE } from '../../flash/mediaImage.ts'
import { busy as flashBusy, useFlash } from '../../flash/useFlash.ts'
import { formatBytes, mediaBudget } from '../../flashLayout.ts'
import { SCREEN, SCREEN_ID } from '../../screens.ts'
import {
  BRIGHTNESS,
  designSize,
  makeId,
  MAX_LAYERS,
  newDesign,
  newTextLayer,
  type Design,
  type DesignMedia,
  type Layer,
  type Orientation,
} from '../../text/design.ts'
import { deleteDesign, listDesigns, saveDesign, type SavedDesign } from '../../text/designsDb.ts'
import { keepInside, largestSize } from '../../text/layout.ts'
import { keepDraft, readDraft } from '../../text/draft.ts'
import { loadFont } from '../../text/fonts.ts'
import { estimateBytes, packDesign } from '../../text/pack.ts'
import { buildScene, loadMediaSource, type MediaSource } from '../../text/render.ts'
import { designThumbnail, designVersion } from '../../text/thumbnail.ts'
import FlashPanel from '../FlashPanel.tsx'
import Footer from '../Footer.tsx'
import Header from '../Header.tsx'
import SerialPanel from '../SerialPanel.tsx'
import DesignLibrary from './DesignLibrary.tsx'
import DesignPreview from './DesignPreview.tsx'
import LayerEditor from './LayerEditor.tsx'
import LayersList from './LayersList.tsx'
import { Choice, ColorField, Slider } from './controls.tsx'
import './text-page.css'

const ORIENTATIONS: readonly { value: `${Orientation}`; label: string; title: string }[] = [
  { value: '0', label: 'Upright', title: 'Upright, pins at the bottom' },
  { value: '90', label: 'Sideways ↺', title: 'Turned left, pins on the right' },
  { value: '270', label: 'Sideways ↻', title: 'Turned right, pins on the left' },
  { value: '180', label: 'Upside down', title: 'Pins at the top' },
]

/** Loads the pictures a design uses, reusing those already loaded. */
async function loadSources(media: readonly DesignMedia[], have: ReadonlyMap<string, MediaSource>) {
  const next = new Map(have)
  for (const item of media) {
    if (next.has(item.id)) continue
    try {
      next.set(item.id, await loadMediaSource(item))
    } catch {
      // A picture that can't be read is left out of the design.
    }
  }
  return next
}

/** Keeps a layer's box on a design that has changed shape. */
function reshape(layer: Layer, from: { width: number; height: number }, to: { width: number; height: number }): Layer {
  const width = layer.x <= 0 && layer.width >= from.width ? to.width : Math.min(layer.width, to.width)
  const height = layer.y <= 0 && layer.height >= from.height ? to.height : Math.min(layer.height, to.height)
  const cx = ((layer.x + layer.width / 2) / from.width) * to.width
  const cy = ((layer.y + layer.height / 2) / from.height) * to.height
  return {
    ...layer,
    width,
    height,
    x: Math.round(Math.min(Math.max(cx - width / 2, 0), to.width - width)),
    y: Math.round(Math.min(Math.max(cy - height / 2, 0), to.height - height)),
  }
}

/** Watches an element's width. */
function useWidth() {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect()
    if (!element || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.current.observe(element)
  }, [])
  return [ref, width] as const
}

/** The Text page: make a sign, save it, send it. */
export default function TextPage() {
  const screen = SCREEN
  const budget = mediaBudget(SCREEN_ID)
  const [design, setDesign] = useState<Design>(() => {
    const kept = readDraft()?.design
    if (!kept) return newDesign(screen)
    const size = designSize(kept.orientation, screen)
    return { ...kept, layers: kept.layers.map((layer) => keepInside(layer, size)) }
  })
  const [dirty, setDirty] = useState(() => readDraft()?.dirty ?? true)
  const [selectedId, setSelectedId] = useState<string | null>(() => readDraft()?.selectedId ?? design.layers.at(-1)?.id ?? null)
  const [library, setLibrary] = useState<SavedDesign[] | null>(null)
  const [libraryError, setLibraryError] = useState(false)
  const [sources, setSources] = useState<ReadonlyMap<string, MediaSource>>(() => new Map())
  const [fontsLoaded, setFontsLoaded] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const replacing = useRef<string | null>(null)
  const designRef = useRef(design)
  useLayoutEffect(() => {
    designRef.current = design
  }, [design])
  const [previewRef, previewWidth] = useWidth()

  useEffect(() => {
    keepDraft({ design, dirty, selectedId })
  }, [design, dirty, selectedId])

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await listDesigns())
      setLibraryError(false)
    } catch {
      setLibrary([])
      setLibraryError(true)
    }
  }, [])

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  // Pictures and lettering load in the background; the design redraws when they arrive.
  useEffect(() => {
    let live = true
    void loadSources(design.media, sources).then((next) => {
      if (live && next.size !== sources.size) setSources(next)
    })
    return () => {
      live = false
    }
  }, [design.media, sources])

  const fonts = useMemo(() => [...new Set(design.layers.flatMap((layer) => (layer.kind === 'text' ? [layer.font] : [])))].sort().join(','), [design.layers])
  useEffect(() => {
    let live = true
    const ids = fonts ? (fonts.split(',') as Parameters<typeof loadFont>[0][]) : []
    void Promise.all(ids.map(loadFont)).then(() => {
      if (live) setFontsLoaded((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [fonts])

  const built = useMemo(() => {
    try {
      return buildScene(design, sources, screen)
    } catch {
      return null // no canvas here (tests): nothing to preview
    }
    // fontsLoaded: letters drawn before a font arrived are drawn again with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, sources, screen, fontsLoaded])

  const size = designSize(design.orientation, screen)
  const selected = design.layers.find((layer) => layer.id === selectedId) ?? null
  const bytes = built ? estimateBytes(built) : 0

  function update(change: (design: Design) => Design) {
    setDesign((current) => change(current))
    setDirty(true)
  }

  /** Every layer stays on the screen, so none can end up where it can't be reached. */
  function inside(layer: Layer, design: Pick<Design, 'orientation'>): Layer {
    return keepInside(layer, designSize(design.orientation, screen))
  }

  function updateLayer(id: string, patch: Partial<Layer>) {
    update((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== id) return layer
        let next = { ...layer, ...patch } as Layer
        // Growing stops at the screen's edge rather than pushing the box along.
        const resized = ('width' in patch || 'height' in patch) && !('x' in patch || 'y' in patch)
        const most = resized ? largestSize(next, designSize(current.orientation, screen)) : null
        if (most) next = { ...next, width: Math.min(next.width, most.width), height: Math.min(next.height, most.height) }
        return inside(next, current)
      }),
    }))
  }

  async function save(current: Design = designRef.current): Promise<SavedDesign | null> {
    setSaving(true)
    try {
      const now = Date.now()
      const record: SavedDesign = { ...current, updatedAt: now }
      const freshSources = await loadSources(current.media, sources)
      const thumbnail = await designThumbnail(record, freshSources, screen).catch(() => null)
      await saveDesign(thumbnail ? { ...record, thumbnail } : record)
      // Later changes made while saving stay unsaved.
      setDesign((latest) => (latest === current ? { ...latest, updatedAt: now } : latest))
      if (designRef.current === current) setDirty(false)
      setNotice(`Saved “${current.name}”.`)
      await refreshLibrary()
      return record
    } catch {
      setNotice("Couldn't save the design in this browser. It may be out of space or in private browsing.")
      return null
    } finally {
      setSaving(false)
    }
  }

  function confirmLeave(): boolean {
    return !dirty || window.confirm('Leave this design without saving your changes?')
  }

  function open(saved: SavedDesign) {
    if (saved.id === design.id || !confirmLeave()) return
    const { thumbnail: _thumbnail, ...rest } = saved
    setDesign({ ...rest, layers: rest.layers.map((layer) => inside(layer, rest)) })
    setDirty(false)
    setSelectedId(rest.layers.at(-1)?.id ?? null)
    setNotice(`Opened “${saved.name}”.`)
  }

  function startNew() {
    if (!confirmLeave()) return
    const fresh = newDesign(screen)
    setDesign(fresh)
    setDirty(true)
    setSelectedId(fresh.layers.at(-1)?.id ?? null)
  }

  async function remove(saved: SavedDesign) {
    if (!window.confirm(`Delete “${saved.name}”? This can't be undone.`)) return
    try {
      await deleteDesign(saved.id)
      if (saved.id === design.id) setDirty(true)
      setNotice(`Deleted “${saved.name}”.`)
    } catch {
      setNotice("Couldn't delete it.")
    }
    await refreshLibrary()
  }

  function addText() {
    const layer = newTextLayer(size, { text: 'Your text', size: Math.round(Math.min(size.height, 90) * 0.5) })
    update((current) => ({ ...current, layers: [...current.layers, layer] }))
    setSelectedId(layer.id)
  }

  function pickPicture(replace: string | null) {
    replacing.current = replace
    fileRef.current?.click()
  }

  function onPicture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const media: DesignMedia = { id: makeId(), name: file.name, type: file.type, blob: file, animated: file.type === 'image/gif' }
    const replace = replacing.current
    if (replace) {
      update((current) => {
        const layers = current.layers.map((layer) => (layer.id === replace && layer.kind === 'picture' ? { ...layer, mediaId: media.id } : layer))
        // The picture it replaced goes, unless another layer uses it.
        const all = [...current.media, media]
        return { ...current, layers, media: all.filter((item) => layers.some((layer) => layer.kind === 'picture' && layer.mediaId === item.id)) }
      })
      return
    }
    const current = designRef.current
    // A GIF goes to the very back, where it can play, unless one is already there.
    const atBack = media.animated && !current.layers.some((layer) => layer.kind === 'picture' && current.media.find((item) => item.id === layer.mediaId)?.animated)
    const width = atBack ? size.width : Math.round(size.width * 0.6)
    const height = atBack ? size.height : Math.round(size.height * 0.6)
    const layer: Layer = {
      id: makeId(),
      kind: 'picture',
      mediaId: media.id,
      fit: atBack ? 'cover' : 'contain',
      rotation: 0,
      blink: 'off',
      x: Math.round((size.width - width) / 2),
      y: Math.round((size.height - height) / 2),
      width,
      height,
    }
    update((latest) => ({
      ...latest,
      media: [...latest.media, media],
      layers: atBack ? [layer, ...latest.layers] : [...latest.layers, layer],
    }))
    setSelectedId(layer.id)
  }

  function moveLayer(id: string, by: -1 | 1) {
    update((current) => {
      const layers = [...current.layers]
      const from = layers.findIndex((layer) => layer.id === id)
      const to = from + by
      if (from < 0 || to < 0 || to >= layers.length) return current
      layers.splice(to, 0, ...layers.splice(from, 1))
      return { ...current, layers }
    })
  }

  function duplicateLayer(id: string) {
    const copyId = makeId()
    update((current) => {
      const index = current.layers.findIndex((layer) => layer.id === id)
      const layer = current.layers[index]
      if (!layer || current.layers.length >= MAX_LAYERS) return current
      const copy = inside({ ...layer, id: copyId, x: layer.x + 10, y: layer.y + 10 }, current)
      return { ...current, layers: [...current.layers.slice(0, index + 1), copy, ...current.layers.slice(index + 1)] }
    })
    setSelectedId(copyId)
  }

  function deleteLayer(id: string) {
    update((current) => {
      const layers = current.layers.filter((layer) => layer.id !== id)
      const media = current.media.filter((item) => layers.some((layer) => layer.kind === 'picture' && layer.mediaId === item.id))
      return { ...current, layers, media }
    })
    if (selectedId === id) setSelectedId(null)
  }

  function setOrientation(orientation: Orientation) {
    update((current) => {
      const from = designSize(current.orientation, screen)
      const to = designSize(orientation, screen)
      return { ...current, orientation, layers: current.layers.map((layer) => keepInside(reshape(layer, from, to), to)) }
    })
  }

  // ---- Sending ----

  /** What a send puts on the screen: the design, packed, and saved so it can be changed later. */
  async function flashSource(): Promise<FlashSource> {
    const current = designRef.current
    await Promise.all(current.layers.flatMap((layer) => (layer.kind === 'text' ? [loadFont(layer.font)] : [])))
    const all = await loadSources(current.media, sources)
    const { payload } = packDesign(buildScene(current, all, screen), budget)
    await save(current)
    return { kind: 'ready', blob: new Blob([payload.slice().buffer], { type: SCENE_TYPE }), type: SCENE_TYPE }
  }

  const flash = useFlash({
    screen,
    budget,
    source: flashSource,
    identity: () => ({ item: `design:${designRef.current.id}`, version: designVersion(designRef.current) }),
  })
  const { dismiss: dismissFlash } = flash
  useEffect(() => {
    dismissFlash()
  }, [design.id, dismissFlash])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const onScreenId = flash.onScreen?.item?.startsWith('design:') ? flash.onScreen.item.slice('design:'.length) : null
  const empty = design.layers.length === 0
  const scale = previewWidth > 0 ? Math.min(2, (previewWidth - 24) / size.width) : 1.5

  return (
    <div className="page">
      <Header page="text" />
      <main className="page-main text-page">
        <div className="preview-column text-page__preview">
          <div ref={previewRef} className="design-preview">
            <div className="design-preview__frame">
              <DesignPreview
                design={design}
                built={built}
                scale={scale}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={updateLayer}
                label={`Preview of “${design.name}” as your screen will show it`}
              />
            </div>
            <p className="helper design-preview__hint">
              Click a layer to change it. Drag to move it, drag its corner to resize. Arrow keys nudge it.
            </p>
          </div>

          <section className="panel design-settings" aria-label="Design">
            <div className="design-settings__name">
              <label className="field__label" htmlFor="design-name">
                Name
              </label>
              <input id="design-name" value={design.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <Choice label="How the screen stands" value={`${design.orientation}` as `${Orientation}`} options={ORIENTATIONS} onChange={(value) => setOrientation(Number(value) as Orientation)} />
            <ColorField label="Background" value={design.background} onChange={(background) => update((current) => ({ ...current, background }))} />
            <div>
              <Slider
                label="Brightness"
                value={design.brightness}
                min={BRIGHTNESS.min}
                max={BRIGHTNESS.max}
                step={5}
                unit="%"
                onChange={(brightness) => update((current) => ({ ...current, brightness }))}
              />
              <p className="helper">The screen’s backlight while this design shows. Pictures and the test card stay at full.</p>
            </div>
            <div className="design-settings__save">
              <button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save design'}
              </button>
              <p className="helper" aria-live="polite">
                {dirty ? 'Changes not saved yet.' : 'All changes saved.'} Uses about {formatBytes(bytes)} of {formatBytes(budget)}.
              </p>
            </div>
            {notice ? (
              <p className="helper design-settings__notice" role="status">
                {notice}
              </p>
            ) : null}
          </section>

          <FlashPanel
            state={flash.state}
            blocked={empty ? 'Add some text or a picture first.' : null}
            screenUrl={flash.device?.url ?? null}
            connect={flash.connect}
            onConnect={flash.connectScreen}
            onKeepAddress={flash.keepAddress}
            onForgetScreen={flash.forgetScreen}
            usbAvailable={flash.usbAvailable}
            board={flash.board}
            onChooseBoard={flash.chooseBoard}
            onStartWifi={flash.startWifi}
            onStartUsb={flash.startUsb}
            onStartScreenPage={flash.startScreenPage}
            onDismiss={flash.dismiss}
            onSubmitWifi={(ssid, password) => void flash.submitWifi(ssid, password)}
            onSkipWifi={flash.skipWifi}
          />
          <p className="helper text-page__player-note">
            Text designs need the screen’s player {SCENE_PLAYER_VERSION} or newer. If yours is older, send once over USB to update it.
          </p>
          {flash.usbAvailable || flash.device ? (
            <SerialPanel
              log={flash.log}
              expected={flash.expected}
              monitoring={flash.monitoring}
              busy={flashBusy(flash.state)}
              onWatch={flash.watchSerial}
              onRestart={flash.restartScreen}
              onStop={flash.stopSerial}
              knownUrl={flash.device?.url ?? null}
              onUseScreen={flash.useScreen}
              usbAvailable={flash.usbAvailable}
              wifiLog={flash.wifiLog}
              onWatchWifi={flash.startWifiLog}
              onStopWifi={flash.stopWifiLog}
            />
          ) : null}
        </div>

        <div className="controls text-page__controls">
          <DesignLibrary
            designs={library}
            unavailable={libraryError}
            currentId={design.id}
            onScreenId={onScreenId}
            onOpen={open}
            onNew={startNew}
            onDelete={(saved) => void remove(saved)}
          />
          <LayersList
            design={design}
            selectedId={selectedId}
            full={design.layers.length >= MAX_LAYERS}
            onSelect={setSelectedId}
            onAddText={addText}
            onAddPicture={() => pickPicture(null)}
            onMove={moveLayer}
            onDuplicate={duplicateLayer}
            onDelete={deleteLayer}
          />
          {selected ? (
            <LayerEditor
              design={design}
              layer={selected}
              size={size}
              onChange={(patch) => updateLayer(selected.id, patch)}
              onReplacePicture={() => pickPicture(selected.id)}
            />
          ) : (
            <p className="helper">{empty ? 'Add text or a picture to start.' : 'Pick a layer to change it.'}</p>
          )}
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onPicture}
          />
        </div>
      </main>
      <Footer />
    </div>
  )
}
