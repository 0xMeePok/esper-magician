import type { CSSProperties, ReactNode } from 'react'
import type { Screen } from '../screens.ts'

type BoardScreenProps = {
  screen: Screen
  children: ReactNode
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

export default function BoardScreen({ screen, children }: BoardScreenProps) {
  return (
    <figure className="board-screen" style={screenStyle(screen)}>
      <div className="bezel-slot">
        <div className="bezel">
          <div className="bezel-opening">{children}</div>
        </div>
      </div>
      <figcaption className="board-caption">{screen.bezelCaption}</figcaption>
      <p className="helper screen-helper" aria-live="polite">
        Pick an example or upload a picture.
      </p>
    </figure>
  )
}
