/**
 * The ESP32 boards the 1.9-inch screen can be wired to. Like ESPVerse, each board gets its own
 * firmware build, because the backlight and button pins differ: firmware made for one board's
 * wiring leaves the other's backlight pin alone, and the screen looks dead.
 * Keep in step with ESPER_BOARD in firmware/main/Kconfig.projbuild.
 */
export const boards = [
  {
    id: 'devkit-38',
    title: '38-pin ESP32 DevKit',
    detail: 'CP2102 USB chip. Screen BLK on GPIO 32, button on GPIO 33.',
  },
  {
    id: 'devkit-30',
    title: '30-pin USB-C ESP32 DevKit',
    detail: 'CH340C USB chip. Screen BLK on GPIO 17, button on GPIO 16.',
  },
] as const

export type Board = (typeof boards)[number]
export type BoardId = Board['id']

export const BOARD_STORAGE_KEY = 'esper-magician:board'

export function isBoardId(value: unknown): value is BoardId {
  return boards.some((board) => board.id === value)
}

export function boardFor(id: BoardId): Board {
  return boards.find((board) => board.id === id)!
}

/** The board picked until another is: the 30-pin USB-C DevKit, the one ESPER screens are built on. */
export const DEFAULT_BOARD: BoardId = 'devkit-30'

export function readBoard(): BoardId {
  try {
    const value = localStorage.getItem(BOARD_STORAGE_KEY)
    return isBoardId(value) ? value : DEFAULT_BOARD
  } catch {
    return DEFAULT_BOARD
  }
}

export function saveBoard(id: BoardId) {
  try {
    localStorage.setItem(BOARD_STORAGE_KEY, id)
  } catch {
    // Private mode or storage off: the board is asked for again next time.
  }
}
