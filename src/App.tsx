import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import BoardScreen from './components/BoardScreen.tsx'
import CompressionPanel from './components/CompressionPanel.tsx'
import CropControl from './components/CropControl.tsx'
import CropEditor from './components/CropEditor.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import MyUploadsSection from './components/MyUploadsSection.tsx'
import ScreenPicker from './components/ScreenPicker.tsx'
import TryYourOwnSection from './components/TryYourOwnSection.tsx'
import { readStoredScreenId, screenFor, storeScreenId, type ScreenId } from './screens.ts'
import { useCompression } from './compress/useCompression.ts'
import { useScreenContent } from './useScreenContent.ts'

export default function App() {
  const [screenId, setScreenId] = useState<ScreenId>(() => readStoredScreenId())
  const screen = screenFor(screenId)
  const content = useScreenContent()
  const [editing, setEditing] = useState(false)
  const cropButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef(false)
  const current = content.current
  const compression = useCompression(current, screenId, content.chooseCompression)
  const showOriginal = compression.state.visible && compression.state.showingOriginal
  const editorOpen = editing && current !== null

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

  function selectScreen(id: ScreenId) {
    setScreenId(id)
    storeScreenId(id)
  }

  return (
    <>
      <div className="page" inert={editorOpen}>
        <Header />
        <main className="page-main">
          <div className="preview-column">
            <ScreenPicker selectedId={screenId} onSelect={selectScreen} />
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
