import { useEffect, useRef, useState } from 'react'
import { openPreview } from './upload.ts'
import { type ViewportState } from './components/viewportState.ts'

export function useUpload() {
  const [state, setState] = useState<ViewportState>({ status: 'empty' })
  const urlRef = useRef<string | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    return () => {
      requestRef.current += 1
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  function openFile(file: File) {
    const request = ++requestRef.current
    const previous = urlRef.current
    urlRef.current = null

    void openPreview(file, previous, (next) => {
      if (requestRef.current !== request) return
      if (next.status === 'content') urlRef.current = next.src
      setState(next)
    }).then((url) => {
      if (requestRef.current !== request && url) URL.revokeObjectURL(url)
    })
  }

  return { state, openFile }
}
