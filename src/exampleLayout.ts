/** Digital clock type sizes: ASH-8 for 320×240, ASH-22 for 170×320. */
export function clockSizes(width: number) {
  return width < 240 ? { time: 40, detail: 14, date: 12 } : { time: 64, detail: 16, date: 14 }
}

/** Info card spacing and type: ASH-8 for 320×240, ASH-22 for 170×320. */
export function infoCardSizes(width: number) {
  return width < 240
    ? { padding: 16, title: 18, titleLine: 24, line: 14, lineHeight: 20 }
    : { padding: 24, title: 22, titleLine: 28, line: 16, lineHeight: 24 }
}
