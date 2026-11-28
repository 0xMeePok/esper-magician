import { useCallback, useEffect, useState } from 'react'

/** The site's pages, each at its own address. */
export const PAGES = [
  { id: 'pictures', path: '/', label: 'Pictures' },
  { id: 'text', path: '/text', label: 'Text' },
] as const

export type PageId = (typeof PAGES)[number]['id']

export function pageFromPath(pathname: string): PageId {
  const path = pathname.replace(/\/+$/, '') || '/'
  return PAGES.find((page) => page.path === path)?.id ?? 'pictures'
}

export function pathFor(id: PageId): string {
  return PAGES.find((page) => page.id === id)?.path ?? '/'
}

const listeners = new Set<() => void>()

/** Moves to another page without reloading, keeping the browser's back button working. */
export function navigate(id: PageId) {
  if (pageFromPath(window.location.pathname) === id) return
  window.history.pushState(null, '', pathFor(id))
  listeners.forEach((listener) => listener())
  window.scrollTo?.(0, 0)
}

/** The page the address shows; follows back and forward. */
export function usePage(): PageId {
  // Rendered with no browser (as some tests do): the first page.
  const read = useCallback(() => (typeof window === 'undefined' ? 'pictures' : pageFromPath(window.location.pathname)), [])
  const [page, setPage] = useState(read)
  useEffect(() => {
    const update = () => setPage(read())
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [read])
  return page
}
