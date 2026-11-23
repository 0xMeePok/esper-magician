import { useId, type Ref } from 'react'
import { CROP_DISABLED_HELPER, CROP_LABEL, CROPPED_CAPTION } from '../cropCopy.ts'

type CropControlProps = {
  enabled: boolean
  cropped: boolean
  announcement: string
  announcementNonce: number
  buttonRef?: Ref<HTMLButtonElement>
  onOpen: () => void
}

export default function CropControl({
  enabled,
  cropped,
  announcement,
  announcementNonce,
  buttonRef,
  onOpen,
}: CropControlProps) {
  const helperId = useId()
  // Alternate a zero-width space so repeating the same sentence is still announced.
  const live = announcement
    ? announcementNonce % 2 === 0
      ? `${announcement}​`
      : announcement
    : ''

  return (
    <div className="crop-control">
      <div className="crop-control__row">
        <button
          ref={buttonRef}
          type="button"
          className="button button-file button-crop"
          aria-disabled={enabled ? undefined : 'true'}
          aria-describedby={enabled ? undefined : helperId}
          onClick={() => {
            if (enabled) onOpen()
          }}
        >
          <CropIcon />
          {CROP_LABEL}
        </button>
        {enabled && cropped ? <span className="crop-control__applied">{CROPPED_CAPTION}</span> : null}
      </div>
      {enabled ? null : (
        <p id={helperId} className="helper crop-control__helper">
          {CROP_DISABLED_HELPER}
        </p>
      )}
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>
    </div>
  )
}

function CropIcon() {
  return (
    <svg
      className="crop-icon"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.5 1v12.5H17M1 4.5h12.5V17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
