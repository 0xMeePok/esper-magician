import { INFO_CARD_LINE, INFO_CARD_TITLE } from '../examples.ts'
import { infoCardSizes } from '../exampleLayout.ts'

type InfoCardProps = {
  width: number
  height: number
}

export default function InfoCard({ width, height }: InfoCardProps) {
  const sizes = infoCardSizes(width)
  return (
    <div className="example-card" style={{ width, height, padding: sizes.padding }}>
      <div className="example-card__group">
        <SunIcon />
        <span
          className="example-card__title"
          style={{ fontSize: sizes.title, lineHeight: `${sizes.titleLine}px` }}
        >
          {INFO_CARD_TITLE}
        </span>
        <span
          className="example-card__line"
          style={{ fontSize: sizes.line, lineHeight: `${sizes.lineHeight}px` }}
        >
          {INFO_CARD_LINE}
        </span>
      </div>
    </div>
  )
}

function SunIcon() {
  return (
    <svg
      className="example-card__icon"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="6" fill="#0F766E" />
      <g stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round">
        <path d="M16 2.5v4M16 25.5v4M2.5 16h4M25.5 16h4M6.5 6.5l2.8 2.8M22.7 22.7l2.8 2.8M6.5 25.5l2.8-2.8M22.7 9.3l2.8-2.8" />
      </g>
    </svg>
  )
}
