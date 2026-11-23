import { useId, type CSSProperties } from 'react'
import type { Screen } from '../screens.ts'
import Viewport from './Viewport.tsx'
import { viewportAnnouncement, type ViewportState } from './viewportState.ts'

type BoardScreenProps = {
  screen: Screen
  state?: ViewportState
  libraryHasItems?: boolean
}

type ScreenStyle = CSSProperties & {
  '--screen-width': string
  '--screen-height': string
}

function screenStyle(screen: Screen): ScreenStyle {
  return {
    '--screen-width': `${screen.width}px`,
    '--screen-height': `${screen.height}px`,
  }
}

export default function BoardScreen({
  screen,
  state = { status: 'empty' },
  libraryHasItems = false,
}: BoardScreenProps) {
  const statusId = useId()
  const announcement = viewportAnnouncement(state, libraryHasItems)

  return (
    <figure className="board-screen" style={screenStyle(screen)}>
      <div className="bezel-slot">
        <div className="bezel">
          <div className="bezel-opening">
            <Viewport state={state} statusId={statusId} width={screen.width} height={screen.height} />
          </div>
        </div>
      </div>
      <figcaption className="board-caption">{screen.bezelCaption}</figcaption>
      <div className="crop-slot" />
      <div id={statusId} className="board-status" aria-live="polite" aria-atomic="true">
        {announcement.kind === 'helper' ? <p className="helper">{announcement.text}</p> : null}
        {announcement.kind === 'error' ? <p className="board-error">{announcement.text}</p> : null}
        {announcement.kind === 'progress' ? (
          <p className="visually-hidden">{announcement.text}</p>
        ) : null}
      </div>
    </figure>
  )
}
