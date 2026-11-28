import { useEffect, useMemo } from 'react'
import type { SavedDesign } from '../../text/designsDb.ts'

type Props = {
  /** Null while loading. */
  designs: SavedDesign[] | null
  unavailable: boolean
  currentId: string
  onScreenId: string | null
  onOpen: (design: SavedDesign) => void
  onNew: () => void
  onDelete: (design: SavedDesign) => void
}

function when(time: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time)
  } catch {
    return new Date(time).toLocaleString()
  }
}

/** Saved designs: open one to change it, start a new one, or delete one. */
export default function DesignLibrary({ designs, unavailable, currentId, onScreenId, onOpen, onNew, onDelete }: Props) {
  const urls = useMemo(() => {
    const map = new Map<string, string>()
    if (typeof URL.createObjectURL !== 'function') return map
    for (const design of designs ?? []) if (design.thumbnail) map.set(design.id, URL.createObjectURL(design.thumbnail))
    return map
  }, [designs])
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls])

  return (
    <section className="panel design-library" aria-labelledby="design-library-heading">
      <div className="design-library__head">
        <h2 id="design-library-heading">My designs</h2>
        <button type="button" className="button button-file button-small" onClick={onNew}>
          New design
        </button>
      </div>
      {unavailable ? <p className="helper">This browser can't keep designs (private browsing?), so they last until the page closes.</p> : null}
      {designs === null ? <p className="helper">Loading…</p> : null}
      {designs?.length === 0 && !unavailable ? <p className="helper">Saved designs show here, ready to change again.</p> : null}
      {designs?.length ? (
        <ul className="design-library__list">
          {designs.map((design) => (
            <li key={design.id} className="design-library__item" aria-current={design.id === currentId ? 'true' : undefined}>
              <button type="button" className="design-library__open" onClick={() => onOpen(design)}>
                {urls.get(design.id) ? (
                  <img className="design-library__thumb" src={urls.get(design.id)} alt="" data-orientation={design.orientation % 180 ? 'wide' : 'tall'} />
                ) : (
                  <span className="design-library__thumb design-library__thumb--empty" aria-hidden="true" />
                )}
                <span className="design-library__copy">
                  <span className="design-library__name">{design.name || 'Untitled'}</span>
                  <span className="design-library__meta">
                    {design.id === onScreenId ? 'On the screen · ' : ''}
                    {when(design.updatedAt)}
                  </span>
                </span>
              </button>
              <button type="button" className="link-button design-library__delete" onClick={() => onDelete(design)} aria-label={`Delete ${design.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
