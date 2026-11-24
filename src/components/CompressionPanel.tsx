import { useId } from 'react'
import type { CompressionState } from '../compress/useCompression.ts'
import type { StrengthId } from '../compress/strengths.ts'
import { formatBytes } from '../flashLayout.ts'
import { COMPRESSION_COPY, compressionBody, readout } from '../compress/copy.ts'

type CompressionPanelProps = {
  state: CompressionState
  onSelect: (strength: StrengthId) => void
  onToggleOriginal: () => void
}

export default function CompressionPanel({ state, onSelect, onToggleOriginal }: CompressionPanelProps) {
  const headingId = useId()
  const groupName = useId()
  if (!state.visible) return null

  const chosen = state.options.find((option) => option.strength === state.chosen)
  const noneFit = state.status === 'ready' && !state.options.some((option) => option.fits)

  return (
    <section className="compression" aria-labelledby={headingId}>
      <h2 id={headingId} className="compression__heading">
        {COMPRESSION_COPY.heading}
      </h2>
      <p className="compression__body">
        {compressionBody(state.originalBytes, state.budget, !noneFit && state.status !== 'failed')}
      </p>

      {state.status === 'working' ? (
        <div className="compression__working" role="status">
          <span>{COMPRESSION_COPY.working}</span>
          <div
            className="compression__progress"
            role="progressbar"
            aria-label={COMPRESSION_COPY.working}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
          >
            <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {state.status === 'failed' ? (
        <p className="compression__message" role="alert">
          {COMPRESSION_COPY.failed}
        </p>
      ) : null}

      {noneFit ? (
        <p className="compression__message" role="alert">
          {COMPRESSION_COPY.noneFit}
        </p>
      ) : null}

      {state.status === 'ready' && !noneFit ? (
        <fieldset className="compression__options">
          <legend className="visually-hidden">Compression strength</legend>
          {state.options.map((option) => (
            <label
              key={option.strength}
              className="compression__option"
              data-fits={option.fits}
              data-selected={option.strength === state.chosen}
            >
              <input
                type="radio"
                name={groupName}
                value={option.strength}
                checked={option.strength === state.chosen}
                disabled={!option.fits}
                onChange={() => onSelect(option.strength)}
              />
              <span className="compression__label">{option.label}</span>
              <span className="compression__size">
                {option.fits ? formatBytes(option.bytes) : `Still too big (${formatBytes(option.bytes)})`}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {chosen ? (
        <div className="compression__readout">
          <p aria-live="polite">
            {state.showingOriginal
              ? 'Showing the original. The compressed copy is what goes on your screen.'
              : readout(chosen.label, chosen.bytes, state.budget)}
          </p>
          <button
            type="button"
            className="button button-file"
            aria-pressed={state.showingOriginal}
            onClick={onToggleOriginal}
          >
            {state.showingOriginal ? COMPRESSION_COPY.showCompressed : COMPRESSION_COPY.showOriginal}
          </button>
        </div>
      ) : null}
    </section>
  )
}
