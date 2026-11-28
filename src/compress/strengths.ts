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
  /**
   * How far a pixel's colour may drift (red + green + blue difference) before a GIF frame redraws
   * it. Unchanged pixels cost almost nothing, so this is where most of a GIF's saving comes from.
   */
  gifTolerance: number
}

/**
 * ASH-34: three strengths, lightest first. GIFs keep every frame at Light and Balanced, so they
 * move as smoothly as the original; only Strong drops frames, as a last resort.
 */
export const STRENGTHS: readonly Strength[] = [
  { id: 'light', label: 'Light', jpegQuality: 85, gifColors: 256, gifFrameStep: 1, gifTolerance: 18 },
  { id: 'balanced', label: 'Balanced', jpegQuality: 65, gifColors: 128, gifFrameStep: 1, gifTolerance: 36 },
  { id: 'strong', label: 'Strong', jpegQuality: 40, gifColors: 48, gifFrameStep: 2, gifTolerance: 60 },
]

export function strengthById(id: string): Strength | undefined {
  return STRENGTHS.find((strength) => strength.id === id)
}
