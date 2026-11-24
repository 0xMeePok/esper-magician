import type { Screen } from './screens.ts'

export const EDITOR_COPY = {
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  rotateLeftLabel: 'Rotate left 90 degrees',
  rotateRightLabel: 'Rotate right 90 degrees',
  reset: 'Reset to original',
  preview: 'Preview',
  cancel: 'Cancel',
  apply: 'Apply',
  gifCaption: 'Showing the first frame. Your crop applies to every frame.',
  decodeError: 'This file couldn\u2019t be opened for cropping.',
  cropArea: 'Crop area',
} as const

export const CROP_LABEL = 'Crop'
export const CROP_DISABLED_HELPER = 'Crop works on your own pictures and GIFs.'
export const CROPPED_CAPTION = 'Cropped for this screen'

export function editorTitle(screen: Screen): string {
  return `Crop for ${screen.title}`
}

export function lockedShapeLabel(screen: Screen): string {
  return `Shape locked to your screen (${screen.width} \u00d7 ${screen.height})`
}

export function rotatedAnnouncement(rotation: number): string {
  return `Rotated to ${rotation} degrees.`
}
