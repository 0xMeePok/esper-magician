import type { ReactNode } from 'react'

type BoardScreenProps = {
  children: ReactNode
}

export default function BoardScreen({ children }: BoardScreenProps) {
  return (
    <figure className="board-screen">
      <div className="bezel">
        <div className="bezel-opening">{children}</div>
      </div>
      <figcaption className="board-caption">Your screen (320 × 240)</figcaption>
    </figure>
  )
}
