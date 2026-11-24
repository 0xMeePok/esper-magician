import type { ScreenId } from '../screens.ts'
import { strengthById, type StrengthId } from './strengths.ts'

/** The compressed file picked for one screen (ASH-35). It is what gets flashed. */
export type CompressedChoice = {
  strength: StrengthId
  /** The crop it was made with (see cropKey). A different crop means it is out of date. */
  cropKey: string
  type: string
  blob: Blob
}

export type CompressedChoices = Partial<Record<ScreenId, CompressedChoice>>

export function parseCompressedChoices(value: unknown): CompressedChoices {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const choices: CompressedChoices = {}
  for (const id of ['1.9'] as const) {
    const entry = source[id] as Partial<CompressedChoice> | undefined
    if (!entry || typeof entry !== 'object') continue
    if (!strengthById(String(entry.strength))) continue
    if (typeof entry.cropKey !== 'string' || typeof entry.type !== 'string') continue
    if (!(entry.blob instanceof Blob)) continue
    choices[id] = {
      strength: entry.strength as StrengthId,
      cropKey: entry.cropKey,
      type: entry.type,
      blob: entry.blob,
    }
  }
  return choices
}

export function withChoice(
  choices: CompressedChoices,
  id: ScreenId,
  choice: CompressedChoice | null,
): CompressedChoices {
  const next = { ...choices }
  if (choice) next[id] = choice
  else delete next[id]
  return next
}
