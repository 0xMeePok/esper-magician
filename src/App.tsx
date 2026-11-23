import { useState } from 'react'
import BoardScreen from './components/BoardScreen.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import ScreenPicker from './components/ScreenPicker.tsx'
import TryYourOwnSection from './components/TryYourOwnSection.tsx'
import { readStoredScreenId, screenFor, storeScreenId, type ScreenId } from './screens.ts'
import { useUpload } from './useUpload.ts'

export default function App() {
  const [screenId, setScreenId] = useState<ScreenId>(() => readStoredScreenId())
  const screen = screenFor(screenId)
  const upload = useUpload()

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
          <BoardScreen screen={screen} state={upload.state} />
        </div>
        <div className="controls">
          <ExamplesSection />
          <TryYourOwnSection onFile={upload.openFile} />
        </div>
      </main>
      <Footer />
    </div>
  )
}
