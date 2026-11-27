import type { BoardId } from '../boards.ts'

/**
 * What came over the screen's USB serial port, line by line. `esptool` lines are esptool-js
 * reporting what the chip answered while flashing; `board` lines are the screen's own output at
 * 115200 baud (ROM, bootloader and player logs). Nothing here is made up: every line was received.
 */
export type LogLine = { source: 'esptool' | 'board'; text: string }

export const MAX_LOG_LINES = 2000

// Colour codes ESP-IDF puts round log lines.
// oxlint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g

/** Joins chunks as they arrive into whole lines. */
export class LineBuffer {
  private pending = ''
  private readonly decoder = new TextDecoder()

  push(chunk: Uint8Array | string): string[] {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    const parts = this.pending.split('\n')
    this.pending = parts.pop() ?? ''
    return parts.map((line) => line.replace(ANSI, '').replace(/\r/g, '')).filter((line) => line.trim() !== '')
  }
}

/** What the website sent, to hold the screen's report up against. */
export type Expected = { board: BoardId | null; crc32: number; length: number }

export type CheckStatus = 'ok' | 'bad' | 'waiting'
export type Check = { id: string; label: string; status: CheckStatus; detail?: string }

function last(lines: string[], pattern: RegExp): RegExpMatchArray | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i]!.match(pattern)
    if (match) return match
  }
  return null
}

function lastIndex(lines: string[], pattern: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i]!)) return i
  return -1
}

const hex = (value: number) => `0x${value.toString(16).padStart(8, '0')}`

/**
 * Reads the screen's own log for proof the install and the picture worked. Keep the patterns in
 * step with the ESP_LOGI lines in firmware/main/main.c and media.c.
 */
export function checkBoardLog(log: LogLine[], expected: Expected | null): Check[] {
  const lines = log.filter((line) => line.source === 'board').map((line) => line.text)
  const checks: Check[] = []

  const player = last(lines, /ESPER player (\S+) on a (\d+)x(\d+) screen/)
  checks.push(
    player
      ? { id: 'boot', label: 'Player started', status: 'ok', detail: `version ${player[1]}, ${player[2]}×${player[3]}` }
      : { id: 'boot', label: 'Player started', status: 'waiting' },
  )

  const board = last(lines, /board (devkit-\d+): .*BLK GPIO (\d+), button GPIO (\d+)/)
  if (!board) checks.push({ id: 'board', label: 'Built for your board', status: 'waiting' })
  else {
    const detail = `${board[1]}: backlight on GPIO ${board[2]}, button on GPIO ${board[3]}`
    const matches = !expected?.board || board[1] === expected.board
    checks.push({
      id: 'board',
      label: matches ? 'Built for your board' : `Built for ${board[1]}, not ${expected?.board}`,
      status: matches ? 'ok' : 'bad',
      detail,
    })
  }

  // A newer "picture" line wins over an older problem, and the other way round.
  const stored = /(JPEG|GIF), (\d+) bytes, CRC 0x([0-9a-f]{8}) OK/
  const damaged = /picture is damaged|picture header is damaged|stored picture not usable|no picture yet|picture is for a/
  const storedAt = lastIndex(lines, stored)
  const damagedAt = lastIndex(lines, damaged)
  if (damagedAt > storedAt) {
    checks.push({ id: 'picture', label: 'Picture arrived intact', status: 'bad', detail: lines[damagedAt]!.trim() })
  } else if (storedAt >= 0) {
    const match = lines[storedAt]!.match(stored)!
    const crc = parseInt(match[3]!, 16)
    const length = Number(match[2])
    const same = !expected || (crc === expected.crc32 && length === expected.length)
    checks.push({
      id: 'picture',
      label: same ? (expected ? 'Picture matches what this site sent' : 'Picture arrived intact') : 'Picture differs from what this site sent',
      status: same ? 'ok' : 'bad',
      detail:
        `${match[1]}, ${length} bytes, CRC ${hex(crc)}` +
        (expected && !same ? ` (sent ${expected.length} bytes, CRC ${hex(expected.crc32)})` : ''),
    })
  } else {
    checks.push({ id: 'picture', label: 'Picture arrived intact', status: 'waiting' })
  }

  const drawn = /drew JPEG (\d+)x(\d+)|GIF (\d+)x(\d+) at/
  const failed = /JPEG decode failed|GIF won't open|GIF frame failed/
  const drawnAt = lastIndex(lines, drawn)
  const failedAt = lastIndex(lines, failed)
  if (failedAt > drawnAt) {
    checks.push({ id: 'drawn', label: 'Picture drawn on the screen', status: 'bad', detail: lines[failedAt]!.trim() })
  } else if (drawnAt >= 0) {
    const match = lines[drawnAt]!.match(drawn)!
    checks.push({
      id: 'drawn',
      label: 'Picture drawn on the screen',
      status: 'ok',
      detail: `${match[1] ?? match[3]}×${match[2] ?? match[4]} pixels`,
    })
  } else {
    checks.push({ id: 'drawn', label: 'Picture drawn on the screen', status: 'waiting' })
  }

  const backlight = last(lines, /backlight on: showing (the picture|the test card)/)
  checks.push(
    backlight
      ? {
          id: 'backlight',
          label: backlight[1] === 'the picture' ? 'Backlight on, showing the picture' : 'Backlight on, showing the test card',
          status: backlight[1] === 'the picture' ? 'ok' : 'bad',
        }
      : { id: 'backlight', label: 'Backlight on', status: 'waiting' },
  )

  const crash = last(lines, /Brownout detector was triggered|Guru Meditation Error.*|abort\(\) was called.*|rst:0x[0-9a-f]+ \((?:TG\dWDT|RTCWDT|SW_CPU)[^)]*\)/)
  if (crash) checks.push({ id: 'crash', label: 'The screen crashed or lost power', status: 'bad', detail: crash[0] })

  return checks
}
