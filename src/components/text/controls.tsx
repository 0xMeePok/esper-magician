import { useId, type ReactNode } from 'react'

/** A row of choices, one picked: a labelled group of radio buttons drawn as buttons. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <fieldset className="choice" disabled={disabled}>
      <legend className="field__label">{label}</legend>
      <div className="choice__options">
        {options.map((option) => (
          <label key={option.value} className="choice__option" title={option.title}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** A slider with its number beside it, both editable. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const id = useId()
  const set = (raw: string) => {
    const next = Number(raw)
    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="slider">
        <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => set(event.target.value)} />
        <span className="slider__value">
          <input
            type="number"
            aria-label={`${label}${unit ? ` (${unit})` : ''}`}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(event) => set(event.target.value)}
          />
          {unit ? <span className="slider__unit">{unit}</span> : null}
        </span>
      </div>
    </div>
  )
}

/** A whole number, for positions and sizes. */
export function NumberField({
  label,
  value,
  onChange,
  min,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
}) {
  const id = useId()
  return (
    <div className="field field--number">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        onChange={(event) => {
          const next = Math.round(Number(event.target.value))
          if (Number.isFinite(next)) onChange(min === undefined ? next : Math.max(min, next))
        }}
      />
    </div>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="field field--color">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <span className="color-field">
        <input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="color-field__hex">{value.toUpperCase()}</span>
      </span>
    </div>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
