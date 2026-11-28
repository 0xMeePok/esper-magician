import type { Design } from './design.ts'

/**
 * The design being edited, kept while moving between pages so nothing is lost on the way to the
 * Pictures page and back. Not across reloads: saving is for that.
 */
export type Draft = { design: Design; dirty: boolean; selectedId: string | null }

let draft: Draft | null = null

export function readDraft(): Draft | null {
  return draft
}

export function keepDraft(next: Draft | null) {
  draft = next
}
