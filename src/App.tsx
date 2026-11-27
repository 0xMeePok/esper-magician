import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import BoardScreen from './components/BoardScreen.tsx'
import CompressionPanel from './components/CompressionPanel.tsx'
import CropControl from './components/CropControl.tsx'
import CropEditor from './components/CropEditor.tsx'
import FlashPanel from './components/FlashPanel.tsx'
import SerialPanel from './components/SerialPanel.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import MyUploadsSection from './components/MyUploadsSection.tsx'
import TryYourOwnSection from './components/TryYourOwnSection.tsx'
import { SCREEN, SCREEN_ID } from './screens.ts'
import { useCompression } from './compress/useCompression.ts'
import { exampleById } from './examples.ts'
import { FLASH_COPY } from './flash/copy.ts'
import type { FlashSource } from './flash/deviceAsset.ts'
import { infoCardPicture } from './flash/infoCard.ts'
import { busy as flashBusy, useFlash } from './flash/useFlash.ts'
import { mediaBudget } from './flashLayout.ts'
import { useScreenContent } from './useScreenContent.ts'

export default function App() {
  const screenId = SCREEN_ID
  const screen = SCREEN
  const content = useScreenContent()
  const [editing, setEditing] = useState(false)
  const cropButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef(false)
  const current = content.current
  const compression = useCompression(current, screenId, content.chooseCompression)
  const showOriginal = compression.state.visible && compression.state.showingOriginal
  const editorOpen = editing && current !== null
  const asset = content.assetFor(screenId)
  const selectedExample = asset?.kind === 'example' ? exampleById(asset.id) : undefined
  const flashBlocked = !asset ? FLASH_COPY.nothing : selectedExample?.kind === 'clock' ? FLASH_COPY.clock : null
  const flash = useFlash({ screen, budget: mediaBudget(screenId), source: flashSource })

  /** What "Put it on my screen" sends, worked out at the moment it is clicked. */
  async function flashSource(): Promise<FlashSource> {
    const now = content.assetFor(screenId)
    if (!now) throw new Error(FLASH_COPY.nothing)
    if (now.kind === 'upload') {
      return now.compressed
        ? { kind: 'ready', blob: now.blob, type: now.type }
        : { kind: 'convert', blob: now.blob, animated: now.animated, crop: now.crop }
    }
    const example = exampleById(now.id)
    if (!example || example.kind === 'clock') throw new Error(FLASH_COPY.clock)
    if (example.kind === 'card') {
      return { kind: 'convert', blob: await infoCardPicture(screen), animated: false, crop: null }
    }
    if (!('src' in example)) throw new Error(FLASH_COPY.clock)
    const response = await fetch(example.src)
    if (!response.ok) throw new Error("The example couldn't be loaded.")
    return { kind: 'convert', blob: await response.blob(), animated: example.kind === 'animation', crop: null }
  }

  useEffect(() => {
    if (editorOpen || !returnFocus.current) return
    returnFocus.current = false
    cropButtonRef.current?.focus()
  }, [editorOpen])

  function closeEditor() {
    returnFocus.current = true
    setEditing(false)
  }

  function openPicker() {
    fileInputRef.current?.click()
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    input.value = ''
    if (file) void content.openFile(file)
  }

  return (
    <>
      <div className="page" inert={editorOpen}>
        <Header />
        <main className="page-main">
          <div className="preview-column">
            <BoardScreen
              screen={screen}
              state={content.viewportFor(screenId, showOriginal)}
              libraryHasItems={content.libraryHasItems}
              cropControl={
                <CropControl
                  enabled={content.canCrop}
                  cropped={Boolean(current?.crops[screenId])}
                  announcement={content.cropMessage.text}
                  announcementNonce={content.cropMessage.nonce}
                  buttonRef={cropButtonRef}
                  onOpen={() => setEditing(true)}
                />
              }
            />
            <CompressionPanel
              state={compression.state}
              onSelect={compression.select}
              onToggleOriginal={compression.toggleOriginal}
            />
            <FlashPanel
              state={flash.state}
              blocked={flashBlocked}
              wireless={flash.device !== null}
              usbAvailable={flash.usbAvailable}
              board={flash.board}
              onChooseBoard={flash.chooseBoard}
              onStart={flash.start}
              onStartUsb={flash.startUsb}
              onSubmitWifi={(ssid, password) => void flash.submitWifi(ssid, password)}
              onSkipWifi={flash.skipWifi}
            />
            {flash.usbAvailable ? (
              <SerialPanel
                log={flash.log}
                expected={flash.expected}
                monitoring={flash.monitoring}
                busy={flashBusy(flash.state)}
                onWatch={flash.watchSerial}
                onRestart={flash.restartScreen}
                onStop={flash.stopSerial}
              />
            ) : null}
          </div>
          <div className="controls">
            <ExamplesSection
              selectedId={content.selectedExampleId}
              onSelect={content.selectExample}
            />
            <TryYourOwnSection onBrowse={openPicker} />
            <MyUploadsSection
              phase={content.phase}
              tiles={content.tiles}
              selectedId={content.selectedId}
              saveError={content.saveError}
              announcement={content.announcement}
              announcementNonce={content.announcementNonce}
              onOpenPicker={openPicker}
              onSelect={content.selectUpload}
              onDelete={content.removeUpload}
            />
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onFileChange}
            />
          </div>
        </main>
        <Footer />
      </div>
      {editorOpen && current ? (
        <CropEditor
          key={`${current.url}:${screenId}`}
          screen={screen}
          media={{
            url: current.url,
            name: current.name,
            animated: current.animated,
            source: current.source,
          }}
          saved={current.crops[screenId] ?? null}
          onCancel={closeEditor}
          onApply={(crop) => {
            content.applyCrop(screenId, crop)
            closeEditor()
          }}
        />
      ) : null}
    </>
  )
}
