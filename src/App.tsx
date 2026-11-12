import BoardScreen from './components/BoardScreen.tsx'
import ExamplesSection from './components/ExamplesSection.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import TryYourOwnSection from './components/TryYourOwnSection.tsx'
import Viewport from './components/Viewport.tsx'

export default function App() {
  return (
    <div className="page">
      <Header />
      <main className="page-main">
        <div className="board-stage">
          <BoardScreen>
            <Viewport />
          </BoardScreen>
        </div>
        <div className="controls">
          <ExamplesSection />
          <TryYourOwnSection />
        </div>
      </main>
      <Footer />
    </div>
  )
}
