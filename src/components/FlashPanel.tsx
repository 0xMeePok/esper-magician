import { useId, useState, type FormEvent } from 'react'
import { FLASH_COPY, problemMessage, suggestsUsb } from '../flash/copy.ts'
import { busy, type FlashState } from '../flash/useFlash.ts'
import './flash-panel.css'

type FlashPanelProps = {
  state: FlashState
  /** Why the button can't be used right now, or null when it can. */
  blocked: string | null
  /** True once this browser knows the screen's Wi-Fi address. */
  wireless: boolean
  /** False when this browser can't use USB (Safari, Firefox, phones). */
  usbAvailable: boolean
  onStart: () => void
  onStartUsb: () => void
  onSubmitWifi: (ssid: string, password: string) => void
  onSkipWifi: () => void
}

function percent(fraction: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100)
}

export default function FlashPanel(props: FlashPanelProps) {
  const { state, blocked, wireless, usbAvailable } = props
  const helperId = useId()
  const working = busy(state)
  const needsUsbFirst = !wireless && !usbAvailable
  const disabled = working || blocked !== null || needsUsbFirst || state.phase === 'wifi-setup'

  let helper: string = wireless ? FLASH_COPY.helperWifi : FLASH_COPY.helperUsb
  if (blocked) helper = blocked
  else if (needsUsbFirst) helper = FLASH_COPY.needsChrome

  return (
    <section className="flash" aria-label="Put it on your screen">
      <button
        type="button"
        className="button button-primary flash__button"
        aria-describedby={helperId}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) props.onStart()
        }}
      >
        {FLASH_COPY.button}
      </button>
      <p id={helperId} className="helper flash__helper">
        {helper}
        {wireless && usbAvailable && !blocked && !working ? (
          <>
            {' '}
            <button type="button" className="link-button" onClick={props.onStartUsb}>
              {FLASH_COPY.useUsb}
            </button>
          </>
        ) : null}
      </p>
      <FlashStatus {...props} />
    </section>
  )
}

function FlashStatus({ state, usbAvailable, onStartUsb, onSubmitWifi, onSkipWifi }: FlashPanelProps) {
  switch (state.phase) {
    case 'idle':
      return <p className="visually-hidden" aria-live="polite" />
    case 'preparing':
    case 'restarting':
    case 'joining': {
      const text =
        state.phase === 'preparing' ? FLASH_COPY.preparing : state.phase === 'restarting' ? FLASH_COPY.restarting : FLASH_COPY.joining
      return (
        <div className="flash__status" aria-live="polite">
          <p>{text}</p>
          <div className="flash__bar flash__bar--busy" role="progressbar" aria-label={text} />
        </div>
      )
    }
    case 'sending': {
      const text = state.route === 'usb' ? FLASH_COPY.installing : FLASH_COPY.sendingWifi
      const value = percent(state.fraction)
      return (
        <div className="flash__status" aria-live="polite">
          <p>
            {text} {value}%
          </p>
          <div
            className="flash__bar"
            role="progressbar"
            aria-label={text}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
          >
            <span style={{ width: `${value}%` }} />
          </div>
        </div>
      )
    }
    case 'wifi-setup':
      return <WifiForm failed={state.failed} onSubmit={onSubmitWifi} onSkip={onSkipWifi} />
    case 'done':
      return (
        <div className="flash__status flash__status--done" aria-live="polite">
          <p>{FLASH_COPY.done}</p>
          <p className="helper">{state.wifi ? FLASH_COPY.doneWifi : FLASH_COPY.doneNoWifi}</p>
        </div>
      )
    case 'error':
      return (
        <div className="flash__status" aria-live="assertive">
          <p className="board-error" role="alert">
            {problemMessage(state.problem, state.detail)}
          </p>
          {state.route === 'wifi' && suggestsUsb(state.problem) && usbAvailable ? (
            <button type="button" className="button button-file" onClick={onStartUsb}>
              {FLASH_COPY.useUsb}
            </button>
          ) : null}
        </div>
      )
  }
}

function WifiForm({
  failed,
  onSubmit,
  onSkip,
}: {
  failed: boolean
  onSubmit: (ssid: string, password: string) => void
  onSkip: () => void
}) {
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const headingId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ssid.trim()) onSubmit(ssid.trim(), password)
  }

  return (
    <form className="flash__wifi" aria-labelledby={headingId} onSubmit={submit}>
      <p className="flash__done">{FLASH_COPY.done}</p>
      <h3 id={headingId}>{FLASH_COPY.wifiHeading}</h3>
      <p className="helper">{FLASH_COPY.wifiHelper}</p>
      {failed ? (
        <p className="board-error" role="alert">
          {FLASH_COPY.wifiFailed}
        </p>
      ) : null}
      <label>
        {FLASH_COPY.wifiName}
        <input value={ssid} onChange={(event) => setSsid(event.target.value)} autoComplete="off" required maxLength={32} />
      </label>
      <label>
        {FLASH_COPY.wifiPassword}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          maxLength={64}
        />
      </label>
      <div className="flash__actions">
        <button type="submit" className="button button-primary">
          {FLASH_COPY.wifiConnect}
        </button>
        <button type="button" className="button button-file" onClick={onSkip}>
          {FLASH_COPY.wifiSkip}
        </button>
      </div>
    </form>
  )
}
