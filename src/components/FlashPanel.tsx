import { useId, useState, type FormEvent } from 'react'
import { boards, type BoardId } from '../boards.ts'
import { FLASH_COPY, problemMessage } from '../flash/copy.ts'
import { busy, type FlashState } from '../flash/useFlash.ts'
import './flash-panel.css'

type FlashPanelProps = {
  state: FlashState
  /** Why nothing can be sent right now, or null when it can. */
  blocked: string | null
  /** True once this browser knows the screen's Wi-Fi address. */
  wireless: boolean
  /** False when this browser can't use USB (Safari, Firefox, phones). */
  usbAvailable: boolean
  /** The board picked for USB installs, or null before one is picked. */
  board: BoardId | null
  onChooseBoard: (id: BoardId) => void
  onStartWifi: () => void
  onStartUsb: () => void
  /** The small-window route, for browsers that can't reach the screen from this page. */
  onStartScreenPage: () => void
  onDismiss: () => void
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
  const held = working || blocked !== null || state.phase === 'wifi-setup'
  const wifiDisabled = held || !wireless
  const usbDisabled = held || !usbAvailable || props.board === null

  let helper: string = wireless ? FLASH_COPY.helperWifi : FLASH_COPY.helperUsb
  if (blocked) helper = blocked
  else if (!usbAvailable) helper = wireless ? FLASH_COPY.helperWifi : FLASH_COPY.needsChrome
  else if (props.board === null) helper = wireless ? `${FLASH_COPY.helperWifi} ${FLASH_COPY.pickBoard}` : FLASH_COPY.pickBoard
  else if (!wireless) helper = `${FLASH_COPY.helperUsb} ${FLASH_COPY.wifiNeedsSetup}`

  return (
    <section className="flash" aria-label="Put it on your screen">
      {usbAvailable ? <BoardPicker board={props.board} disabled={working} onChoose={props.onChooseBoard} /> : null}
      <div className="flash__buttons">
        <SendButton label={FLASH_COPY.sendWifi} disabled={wifiDisabled} describedBy={helperId} onClick={props.onStartWifi} />
        <SendButton label={FLASH_COPY.sendUsb} disabled={usbDisabled} describedBy={helperId} onClick={props.onStartUsb} />
      </div>
      <p id={helperId} className="helper flash__helper">
        {helper}
      </p>
      <FlashStatus {...props} />
    </section>
  )
}

function SendButton({
  label,
  disabled,
  describedBy,
  onClick,
}: {
  label: string
  disabled: boolean
  describedBy: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="button button-primary flash__button"
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick()
      }}
    >
      {label}
    </button>
  )
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="flash__dismiss" aria-label={FLASH_COPY.dismiss} title={FLASH_COPY.dismiss} onClick={onClick}>
      ×
    </button>
  )
}

function BoardPicker({
  board,
  disabled,
  onChoose,
}: {
  board: BoardId | null
  disabled: boolean
  onChoose: (id: BoardId) => void
}) {
  const helperId = useId()
  return (
    <fieldset className="flash__boards" aria-describedby={helperId} disabled={disabled}>
      <legend>{FLASH_COPY.boardHeading}</legend>
      <p id={helperId} className="helper">
        {FLASH_COPY.boardHelper}
      </p>
      {boards.map((option) => (
        <label key={option.id} className="flash__board">
          <input
            type="radio"
            name="esper-board"
            value={option.id}
            checked={board === option.id}
            onChange={() => onChoose(option.id)}
          />
          <span>
            <strong>{option.title}</strong>
            <span className="helper">{option.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function FlashStatus({ state, onStartScreenPage, onDismiss, onSubmitWifi, onSkipWifi }: FlashPanelProps) {
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
      if (state.fraction === null) {
        // No progress to show: the screen draws its own bar while the picture arrives.
        return (
          <div className="flash__status" aria-live="polite">
            <p>{text}</p>
            <div className="flash__bar flash__bar--busy" role="progressbar" aria-label={text} />
          </div>
        )
      }
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
        <div className="flash__status flash__status--done flash__status--dismissable" aria-live="polite">
          <DismissButton onClick={onDismiss} />
          <p>{FLASH_COPY.done}</p>
          <p className="helper">{state.wifi ? FLASH_COPY.doneWifi : FLASH_COPY.doneNoWifi}</p>
        </div>
      )
    case 'error':
      return (
        <div className="flash__status flash__status--dismissable" aria-live="assertive">
          <DismissButton onClick={onDismiss} />
          <p className="board-error" role="alert">
            {problemMessage(state.problem, state.detail)}
          </p>
          {state.route === 'wifi' && state.problem === 'unreachable' ? (
            <>
              <button type="button" className="button button-file" onClick={onStartScreenPage}>
                {FLASH_COPY.screenPage}
              </button>
              <p className="helper">{FLASH_COPY.screenPageHelper}</p>
            </>
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
