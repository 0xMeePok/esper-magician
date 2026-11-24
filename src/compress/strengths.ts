export type StrengthId = 'light' | 'balanced' | 'strong'

export type Strength = {
  id: StrengthId
  label: string
  /** MozJPEG quality for pictures (0-100). */
  jpegQuality: number
  /** Most colors per GIF frame. */
  gifColors: number
  /** Keep every Nth GIF frame; dropped frames' delays go to the kept one. */
  gifFrameStep: number
}

/** ASH-34: three strengths, lightest first. */
export const STRENGTHS: readonly Strength[] = [
  { id: 'light', label: 'Light', jpegQuality: 85, gifColors: 256, gifFrameStep: 1 },
  { id: 'balanced', label: 'Balanced', jpegQuality: 65, gifColors: 64, gifFrameStep: 2 },
  { id: 'strong', label: 'Strong', jpegQuality: 40, gifColors: 16, gifFrameStep: 3 },
]

export function strengthById(id: string): Strength | undefined {
  return STRENGTHS.find((strength) => strength.id === id)
}
