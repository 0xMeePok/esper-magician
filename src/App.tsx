import PicturesPage from './PicturesPage.tsx'
import TextPage from './components/text/TextPage.tsx'
import { usePage } from './route.ts'

export default function App() {
  return usePage() === 'text' ? <TextPage /> : <PicturesPage />
}
