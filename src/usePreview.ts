import { useEffect, useRef, useState } from 'react'
import { exampleById } from './examples.ts'
import { keepsCurrentExample, showExample, showUpload } from './preview.ts'
import { type ViewportState } from './components/viewportState.ts'

export function usePreview() {
  const [state, setState] = useState<ViewportState>({ status: 'empty' })
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(null)
  const stateRef = useRef(state)
  const selectedRef = useRef(selectedExampleId)
  const urlRef = useRef<string | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    return () => {
      requestRef.current += 1
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  function commit(request: number, selectedId: string | null, next: ViewportState) {
    if (requestRef.current !== request) return
    if (next.status === 'content' && next.src.startsWith('blob:')) urlRef.current = next.src
    stateRef.current = next
    selectedRef.current = selectedId
    setState(next)
    setSelectedExampleId(selectedId)
  }

  function openFile(file: File) {
    const request = ++requestRef.current
    const previous = urlRef.current
    urlRef.current = null

    void showUpload(file, previous, (selectedId, next) => {
      commit(request, selectedId, next)
    }).then((url) => {
      if (requestRef.current !== request && url) URL.revokeObjectURL(url)
    })
  }

  function selectExample(id: string) {
    if (!exampleById(id)) return
    if (keepsCurrentExample(selectedRef.current, stateRef.current, id)) return

    const request = ++requestRef.current
    const previous = urlRef.current
    urlRef.current = null

    void showExample(id, previous, (selectedId, next) => {
      commit(request, selectedId, next)
    })
  }

  return { state, selectedExampleId, openFile, selectExample }
}
