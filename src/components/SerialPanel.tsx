import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FLASH_COPY } from '../flash/copy.ts'
import {
  checkBoardLog,
  isWifiLine,
  screenWifi,
  signalWords,
  type Check,
  type Expected,
  type LogLine,
  type ScreenWifi,
} from '../flash/serialLog.ts'
import './serial-panel.css'

type SerialPanelProps = {
  log: LogLine[]
  expected: Expected | null
  /** True while the screen's serial port is open and being read. */
  monitoring: boolean
  /** True while an install or send is running, so the port can't be taken. */
  busy: boolean
  /** The address Wi-Fi sends go to, if this browser knows one. */
  knownUrl: string | null
  /** Makes Wi-Fi sends go to the screen at these addresses. */
  onUseScreen: (url: string, localUrl: string | null) => void
  onWatch: () => void
  onRestart: () => void
  onStop: () => void
}

const VIEW_STORAGE_KEY = 'esper-magician:serial-view'
type View = 'wifi' | 'all'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'all' ? 'all' : 'wifi'
  } catch {
    return 'wifi'
  }
}

const MARK: Record<Check['status'], string> = { ok: '✓', bad: '✗', waiting: '…' }

/** The screen's own serial output, as received, and what it says about the picture. */
export default function SerialPanel(props: SerialPanelProps) {
  const { log, expected, monitoring, busy, onWatch, onRestart, onStop } = props
  const headingId = useId()
  const pre = useRef<HTMLPreElement>(null)
  const [view, setView] = useState<View>(readView)
  const checks = useMemo(() => checkBoardLog(log, expected), [log, expected])
  const wifi = useMemo(() => screenWifi(log), [log])
  const shown = useMemo(() => (view === 'wifi' ? log.filter(isWifiLine) : log), [log, view])
  const heardBoard = log.some((line) => line.source === 'board')

  useEffect(() => {
    const element = pre.current
    if (element) element.scrollTop = element.scrollHeight
  }, [shown])

  function chooseView(next: View) {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Storage off: the choice lasts until the page reloads.
    }
  }

  return (
    <section className="serial" aria-labelledby={headingId}>
      <h3 id={headingId}>{FLASH_COPY.serialHeading}</h3>
      <p className="helper">{FLASH_COPY.serialHelper}</p>

      {heardBoard ? (
        <WifiCard wifi={wifi} knownUrl={props.knownUrl} onUseScreen={props.onUseScreen} />
      ) : null}

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

      <div className="serial__views" role="radiogroup" aria-label={FLASH_COPY.serialViewLabel}>
        {(['wifi', 'all'] as const).map((option) => (
          <label key={option} className="serial__view">
            <input
              type="radio"
              name="serial-view"
              value={option}
              checked={view === option}
              onChange={() => chooseView(option)}
            />
            {option === 'wifi' ? FLASH_COPY.serialViewWifi : FLASH_COPY.serialViewAll}
          </label>
        ))}
      </div>

      <pre ref={pre} className="serial__log" aria-live="off" tabIndex={0}>
        {shown.length
          ? shown.map((line, index) => (
              <span key={index} className={`serial__line serial__line--${line.source}`}>
                {line.source === 'esptool' ? '[esptool] ' : ''}
                {line.text}
                {'\n'}
              </span>
            ))
          : log.length
            ? FLASH_COPY.serialNoWifiLines
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

/** What the screen would show about its Wi-Fi, for when the screen itself is dark. */
function WifiCard({
  wifi,
  knownUrl,
  onUseScreen,
}: {
  wifi: ScreenWifi | null
  knownUrl: string | null
  onUseScreen: (url: string, localUrl: string | null) => void
}) {
  return (
    <div className="serial__screen" aria-live="polite">
      <h4>{FLASH_COPY.screenWouldShow}</h4>
      {!wifi ? <p className="helper">{FLASH_COPY.wifiWaiting}</p> : null}
      {wifi?.hotspot ? (
        <div className="serial__hotspot">
          <p>
            <strong>{FLASH_COPY.setupMode}</strong>
          </p>
          <p>
            Join the Wi-Fi network <strong className="serial__ssid">{wifi.hotspot.name}</strong> (no password) on your
            phone or computer. A setup page should open; if not, go to{' '}
            <a href={wifi.hotspot.url} target="_blank" rel="noreferrer">
              {wifi.hotspot.url}
            </a>
            .
          </p>
          <p className="helper">{FLASH_COPY.setupNoInternet}</p>
        </div>
      ) : null}
      {wifi?.network ? (
        <p>
          {wifi.connected ? 'On Wi-Fi ' : 'Joining '}
          <strong className="serial__ssid">{wifi.network}</strong>
          {wifi.rssi !== null && wifi.connected ? ` · signal ${signalWords(wifi.rssi)} (${wifi.rssi} dBm)` : ''}
          {wifi.connected ? '' : '…'}
        </p>
      ) : null}
      {wifi?.problem && !wifi.connected ? <p className="board-error">{wifi.problem}</p> : null}
      {wifi?.connected && wifi.url ? (
        <>
          <p>
            Address <code>{wifi.url}</code>
            {wifi.localUrl ? (
              <>
                {' '}
                (also <code>{wifi.localUrl}</code>)
              </>
            ) : null}
          </p>
          {knownUrl === wifi.url ? (
            <p className="helper">{FLASH_COPY.screenInUse}</p>
          ) : (
            <button type="button" className="button button-file" onClick={() => onUseScreen(wifi.url!, wifi.localUrl)}>
              {FLASH_COPY.useThisScreen}
            </button>
          )}
        </>
      ) : null}
    </div>
  )
}
