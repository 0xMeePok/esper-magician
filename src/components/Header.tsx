import type { MouseEvent } from 'react'
import { navigate, PAGES, type PageId } from '../route.ts'

const COPY: Record<PageId, { tagline: string; subtitle: string }> = {
  pictures: {
    tagline: 'See how pictures and examples will look on your screen.',
    subtitle: 'Preview on your 1.9-inch color screen, then put it on with one click.',
  },
  text: {
    tagline: 'Make a sign: scrolling, neon or LED text, with pictures if you like.',
    subtitle: 'Place it, colour it and set it moving, save it to change later, then send it to your screen.',
  },
}

export default function Header({ page }: { page: PageId }) {
  function go(event: MouseEvent<HTMLAnchorElement>, id: PageId) {
    // Ordinary clicks stay on this page; new-tab clicks work as links.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(id)
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="site-header-top">
          <h1>ESPER-MAGICIAN</h1>
          <nav className="site-nav" aria-label="Pages">
            {PAGES.map((item) => (
              <a
                key={item.id}
                href={item.path}
                className="site-nav__link"
                aria-current={item.id === page ? 'page' : undefined}
                onClick={(event) => go(event, item.id)}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <p className="tagline">{COPY[page].tagline}</p>
        <p className="subtitle">{COPY[page].subtitle}</p>
      </div>
    </header>
  )
}
