import { useRef, useState, type KeyboardEvent } from 'react'
import { examples, nextExampleIndex, ON_THE_SCREEN, SELECTED } from '../examples.ts'
import type { ItemStatus } from '../flash/onScreen.ts'

type ExamplesSectionProps = {
  selectedId: string | null
  /** How each example is marked: on the screen, selected to send, or neither. */
  statusFor: (id: string) => ItemStatus
  onSelect: (id: string) => void
}

export default function ExamplesSection({ selectedId, statusFor, onSelect }: ExamplesSectionProps) {
  const [focusIndex, setFocusIndex] = useState(0)
  const rows = useRef<Array<HTMLDivElement | null>>([])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target =
      event.target instanceof HTMLElement ? event.target.closest('[role="radio"]') : null
    const current = rows.current.findIndex((row) => row === target)
    const index = current === -1 ? focusIndex : current

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const example = examples[index]
      if (example) onSelect(example.id)
      return
    }

    const next = nextExampleIndex(index, event.key, examples.length)
    if (next === null) return
    event.preventDefault()

    const from = rows.current[index]
    const to = rows.current[next]
    if (from && from !== to) from.tabIndex = -1
    if (to) {
      to.tabIndex = 0
      to.focus()
    }
    setFocusIndex(next)
  }

  return (
    <section className="panel" aria-labelledby="examples-heading">
      <h2 id="examples-heading">Examples</h2>
      <div
        className="example-options"
        role="radiogroup"
        aria-labelledby="examples-heading"
        onKeyDown={onKeyDown}
      >
        {examples.map((example, index) => {
          const selected = example.id === selectedId
          const status = statusFor(example.id)
          return (
            <div
              key={example.id}
              className="example-row"
              role="radio"
              aria-checked={selected}
              data-status={status ?? undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              ref={(node) => {
                rows.current[index] = node
              }}
              onClick={() => {
                setFocusIndex(index)
                onSelect(example.id)
              }}
            >
              <img
                className="example-thumb"
                src={example.thumbnail}
                alt=""
                width={64}
                height={48}
              />
              <span className="example-copy">
                <span className="example-title">{example.title}</span>
                <span className="example-description">{example.description}</span>
                {status === 'on-screen' ? <span className="example-status">{ON_THE_SCREEN}</span> : null}
                {status === 'selected' ? (
                  <span className="example-status example-status--selected">{SELECTED}</span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
