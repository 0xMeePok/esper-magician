import { useEffect, useId, useMemo, useRef } from 'react'
import { FLASH_COPY } from '../flash/copy.ts'
import { checkBoardLog, type Check, type Expected, type LogLine } from '../flash/serialLog.ts'
import './serial-panel.css'

type SerialPanelProps = {
  log: LogLine[]
  expected: Expected | null
  /** True while the screen's serial port is open and being read. */
  monitoring: boolean
  /** True while an install or send is running, so the port can't be taken. */
  busy: boolean
  onWatch: () => void
  onRestart: () => void
  onStop: () => void
}

const MARK: Record<Check['status'], string> = { ok: '✓', bad: '✗', waiting: '…' }

/** The screen's own serial output, as received, and what it says about the picture. */
export default function SerialPanel({ log, expected, monitoring, busy, onWatch, onRestart, onStop }: SerialPanelProps) {
  const headingId = useId()
  const pre = useRef<HTMLPreElement>(null)
  const checks = useMemo(() => checkBoardLog(log, expected), [log, expected])
  const heardBoard = log.some((line) => line.source === 'board')

  useEffect(() => {
    const element = pre.current
    if (element) element.scrollTop = element.scrollHeight
  }, [log])

  return (
    <section className="serial" aria-labelledby={headingId}>
      <h3 id={headingId}>{FLASH_COPY.serialHeading}</h3>
      <p className="helper">{FLASH_COPY.serialHelper}</p>

      {heardBoard ? (
        <div className="serial__checks">
          <h4>{FLASH_COPY.serialChecksHeading}</h4>
          <ul>
            {checks.map((check) => (
              <li key={check.id} className={`serial__check serial__check--${check.status}`}>
                <span aria-hidden="true">{MARK[check.status]}</span>
                <span>
                  {check.label}
                  {check.detail ? <span className="helper"> {check.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="helper">{FLASH_COPY.serialChecksNote}</p>
        </div>
      ) : null}

      <pre ref={pre} className="serial__log" aria-live="off" tabIndex={0}>
        {log.length
          ? log.map((line, index) => (
              <span key={index} className={`serial__line serial__line--${line.source}`}>
                {line.source === 'esptool' ? '[esptool] ' : ''}
                {line.text}
                {'\n'}
              </span>
            ))
          : monitoring
            ? FLASH_COPY.serialListening
            : FLASH_COPY.serialEmpty}
      </pre>

      <div className="serial__actions">
        {monitoring ? (
          <>
            <button type="button" className="button button-file" onClick={onRestart} disabled={busy}>
              {FLASH_COPY.serialRestart}
            </button>
            <button type="button" className="button button-file" onClick={onStop} disabled={busy}>
              {FLASH_COPY.serialStop}
            </button>
          </>
        ) : (
          <button type="button" className="button button-file" onClick={onWatch} disabled={busy}>
            {FLASH_COPY.serialWatch}
          </button>
        )}
      </div>
    </section>
  )
}
