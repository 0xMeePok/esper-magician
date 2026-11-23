import { useState, type ChangeEvent } from 'react'
import BoardScreen from './components/BoardScreen.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import MyUploadsSection from './components/MyUploadsSection.tsx'
import ScreenPicker from './components/ScreenPicker.tsx'
import TryYourOwnSection from './components/TryYourOwnSection.tsx'
import { readStoredScreenId, screenFor, storeScreenId, type ScreenId } from './screens.ts'
import { useUploads } from './useUploads.ts'

export default function App() {
  const [screenId, setScreenId] = useState<ScreenId>(() => readStoredScreenId())
  const screen = screenFor(screenId)
  const uploads = useUploads()

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    input.value = ''
    if (file) void uploads.openFile(file)
  }

  function selectScreen(id: ScreenId) {
    setScreenId(id)
    storeScreenId(id)
  }

  return (
    <div className="page">
      <Header />
      <main className="page-main">
        <div className="preview-column">
          <ScreenPicker selectedId={screenId} onSelect={selectScreen} />
          <BoardScreen
            screen={screen}
            state={uploads.viewport}
            libraryHasItems={uploads.libraryHasItems}
          />
        </div>
        <div className="controls">
          <ExamplesSection />
          <TryYourOwnSection onBrowse={uploads.openPicker} />
          <MyUploadsSection
            phase={uploads.phase}
            tiles={uploads.tiles}
            selectedId={uploads.selectedId}
            saveError={uploads.saveError}
            announcement={uploads.announcement}
            announcementNonce={uploads.announcementNonce}
            onOpenPicker={uploads.openPicker}
            onSelect={uploads.selectUpload}
            onDelete={uploads.removeUpload}
          />
          <input
            ref={uploads.inputRef}
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
  )
}
