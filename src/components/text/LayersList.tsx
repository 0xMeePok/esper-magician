import type { Design, Layer } from '../../text/design.ts'

type Props = {
  design: Design
  selectedId: string | null
  full: boolean
  onSelect: (id: string) => void
  onAddText: () => void
  onAddPicture: () => void
  /** -1 toward the back, 1 toward the front. */
  onMove: (id: string, by: -1 | 1) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

function describe(design: Design, layer: Layer): { name: string; detail: string } {
  if (layer.kind === 'text') {
    const look = { plain: 'Plain', neon: 'Neon', led: 'LED' }[layer.effect]
    const moves = layer.scroll === 'none' ? (layer.blink === 'off' ? 'still' : 'blinking') : `scrolling ${layer.scroll}`
    return { name: layer.text.trim().replace(/\s+/g, ' ') || 'Empty text', detail: `${look} text, ${moves}` }
  }
  const media = design.media.find((item) => item.id === layer.mediaId)
  const moving = media?.animated && design.layers[0]?.id === layer.id
  return { name: media?.name ?? 'Picture', detail: moving ? 'Moving picture, at the back' : 'Picture' }
}

/** The design's layers, front first: pick one to change it, reorder, copy or remove. */
export default function LayersList({ design, selectedId, full, onSelect, onAddText, onAddPicture, onMove, onDuplicate, onDelete }: Props) {
  const frontFirst = [...design.layers].reverse()
  return (
    <section className="panel layers" aria-labelledby="layers-heading">
      <div className="layers__head">
        <h2 id="layers-heading">Layers</h2>
        <div className="button-row">
          <button type="button" className="button button-file button-small" onClick={onAddText} disabled={full}>
            + Text
          </button>
          <button type="button" className="button button-file button-small" onClick={onAddPicture} disabled={full}>
            + Picture
          </button>
        </div>
      </div>
      {full ? <p className="helper">That's the most layers a design can have.</p> : null}
      {frontFirst.length ? (
        <ul className="layers__list">
          {frontFirst.map((layer) => {
            const index = design.layers.indexOf(layer)
            const { name, detail } = describe(design, layer)
            return (
              <li key={layer.id} className="layers__item" aria-current={layer.id === selectedId ? 'true' : undefined}>
                <button type="button" className="layers__pick" onClick={() => onSelect(layer.id)}>
                  <span className="layers__icon" aria-hidden="true">
                    {layer.kind === 'text' ? 'T' : '▣'}
                  </span>
                  <span className="layers__copy">
                    <span className="layers__name">{name}</span>
                    <span className="layers__detail">{detail}</span>
                  </span>
                </button>
                <span className="layers__actions">
                  <button type="button" className="icon-button" onClick={() => onMove(layer.id, 1)} disabled={index === design.layers.length - 1} aria-label={`Bring ${name} forward`} title="Bring forward">
                    ↑
                  </button>
                  <button type="button" className="icon-button" onClick={() => onMove(layer.id, -1)} disabled={index === 0} aria-label={`Send ${name} back`} title="Send back">
                    ↓
                  </button>
                  <button type="button" className="icon-button" onClick={() => onDuplicate(layer.id)} disabled={full} aria-label={`Copy ${name}`} title="Copy">
                    ⧉
                  </button>
                  <button type="button" className="icon-button" onClick={() => onDelete(layer.id)} aria-label={`Delete ${name}`} title="Delete">
                    ✕
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="helper">No layers yet.</p>
      )}
    </section>
  )
}
