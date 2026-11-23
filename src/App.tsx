import { useState } from 'react'
import BoardScreen from './components/BoardScreen.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import ScreenPicker from './components/ScreenPicker.tsx'
import TryYourOwnSection from './components/TryYourOwnSection.tsx'
import { readStoredScreenId, screenFor, storeScreenId, type ScreenId } from './screens.ts'
import { usePreview } from './usePreview.ts'

export default function App() {
  const [screenId, setScreenId] = useState<ScreenId>(() => readStoredScreenId())
  const screen = screenFor(screenId)
  const preview = usePreview()

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
          <BoardScreen screen={screen} state={preview.state} />
        </div>
        <div className="controls">
          <ExamplesSection selectedId={preview.selectedExampleId} onSelect={preview.selectExample} />
          <TryYourOwnSection onFile={preview.openFile} />
        </div>
      </main>
      <Footer />
    </div>
  )
}
