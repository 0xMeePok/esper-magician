import { isAnimatedMedia } from './upload.ts'
import { byNewest, type UploadRecord } from './uploadsDb.ts'

export const SAVED_MESSAGE = 'Saved to My uploads'
export const REMOVED_MESSAGE = 'Removed'
export const QUOTA_MESSAGE =
  "Couldn't save this upload. Your device storage for this site is full. Remove an older upload and try again."
export const UNAVAILABLE_MESSAGE =
  "Uploads can't be saved in this browser. They'll still show on the screen."

export type UploadListState = {
  phase: 'loading' | 'ready' | 'unavailable'
  items: UploadRecord[]
  selectedId: string | null
  saveError: string | null
  announcement: string
  announcementNonce: number
}

export const initialUploadListState: UploadListState = {
  phase: 'loading',
  items: [],
  selectedId: null,
  saveError: null,
  announcement: '',
  announcementNonce: 0,
}

export type UploadListAction =
  | { type: 'loaded'; items: UploadRecord[] }
  | { type: 'unavailable' }
  | { type: 'added'; record: UploadRecord; select: boolean }
  | { type: 'quota' }
  | { type: 'selected'; id: string }
  | { type: 'deleted'; id: string }

function announce(state: UploadListState, text: string) {
  return { announcement: text, announcementNonce: state.announcementNonce + 1 }
}

export function uploadListReducer(state: UploadListState, action: UploadListAction): UploadListState {
  switch (action.type) {
    case 'loaded': {
      if (state.phase !== 'loading') return state
      return {
        ...state,
        phase: 'ready',
        items: [...action.items].sort(byNewest),
        selectedId: null,
        saveError: null,
      }
    }
    case 'unavailable': {
      if (state.phase !== 'loading') return state
      return {
        ...state,
        phase: 'unavailable',
        items: [],
        selectedId: null,
        saveError: null,
        ...announce(state, UNAVAILABLE_MESSAGE),
      }
    }
    case 'added': {
      const items = [...state.items.filter((item) => item.id !== action.record.id), action.record].sort(
        byNewest,
      )
      if (!action.select) return { ...state, phase: 'ready', items }
      return {
        ...state,
        phase: 'ready',
        items,
        selectedId: action.record.id,
        saveError: null,
        ...announce(state, SAVED_MESSAGE),
      }
    }
    case 'quota':
      return {
        ...state,
        selectedId: null,
        saveError: QUOTA_MESSAGE,
        ...announce(state, QUOTA_MESSAGE),
      }
    case 'selected':
      return { ...state, selectedId: action.id, saveError: null }
    case 'deleted':
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        ...announce(state, REMOVED_MESSAGE),
      }
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

export function tileLabel(name: string, type: string, selected: boolean): string {
  const kind = isAnimatedMedia(name, type) ? 'animation' : 'picture'
  return selected ? `${name}, ${kind}, On the screen` : `${name}, ${kind}`
}

export function moveTileIndex(index: number, count: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1)
    case 'ArrowRight':
      return Math.min(count - 1, index + 1)
    case 'ArrowUp':
      return index >= 3 ? index - 3 : index
    case 'ArrowDown':
      return index + 3 < count ? index + 3 : index
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

export function focusAfterDelete(index: number, countAfter: number): number | 'heading' {
  if (countAfter <= 0) return 'heading'
  if (index < countAfter) return index
  return countAfter - 1
}
