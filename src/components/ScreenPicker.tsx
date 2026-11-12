import type { KeyboardEvent } from 'react'
import { screens, type ScreenId } from '../screens.ts'

type ScreenPickerProps = {
  selectedId: ScreenId
  onSelect: (id: ScreenId) => void
}

export default function ScreenPicker({ selectedId, onSelect }: ScreenPickerProps) {
  function selectOnEnter(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter') return
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return
    if (target.checked) return
    target.click()
  }

  return (
    <div
      className="screen-picker"
      role="radiogroup"
      aria-labelledby="screen-picker-label"
      onKeyDown={selectOnEnter}
    >
      <div className="screen-picker-label" id="screen-picker-label">
        Your screen
      </div>
      <div className="screen-options">
        {screens.map((screen) => (
          <label className="screen-option" key={screen.id}>
            <input
              className="screen-option-input"
              type="radio"
              name="screen"
              value={screen.id}
              checked={selectedId === screen.id}
              tabIndex={selectedId === screen.id ? 0 : -1}
              onChange={() => {
                onSelect(screen.id)
              }}
            />
            <OrientationGlyph orientation={screen.orientation} />
            <span className="screen-option-text">
              <span className="screen-option-title">{screen.title}</span>
              <span className="screen-option-caption">{screen.caption}</span>
            </span>
            <span className="screen-radio" aria-hidden="true" />
          </label>
        ))}
      </div>
    </div>
  )
}

function OrientationGlyph({ orientation }: { orientation: 'landscape' | 'portrait' }) {
  const rect =
    orientation === 'landscape'
      ? { x: 1, y: 5, width: 22, height: 14 }
      : { x: 6, y: 1, width: 12, height: 22 }

  return (
    <svg className="screen-glyph" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  )
}
