/**
 * Lettering for text designs. The web fonts are bundled with the site (no font service is asked),
 * and the screen never needs them: the website draws the letters into pictures before sending.
 */
import '@fontsource/bungee/400.css'
import '@fontsource/monoton/400.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/pacifico/400.css'
import '@fontsource/press-start-2p/400.css'
import '@fontsource/vt323/400.css'

export const FONTS = [
  { id: 'block', label: 'Block', family: '"Bungee"', weight: 400 },
  { id: 'pixel', label: 'Pixel', family: '"Press Start 2P"', weight: 400 },
  { id: 'terminal', label: 'Terminal', family: '"VT323"', weight: 400 },
  { id: 'tube', label: 'Neon tube', family: '"Monoton"', weight: 400 },
  { id: 'script', label: 'Script', family: '"Pacifico"', weight: 400 },
  { id: 'future', label: 'Future', family: '"Orbitron"', weight: 700 },
  { id: 'sans', label: 'Bold sans', family: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', weight: 800 },
  { id: 'serif', label: 'Serif', family: 'Georgia, "Times New Roman", serif', weight: 700 },
  { id: 'mono', label: 'Typewriter', family: 'ui-monospace, Menlo, Consolas, monospace', weight: 700 },
] as const

export type FontId = (typeof FONTS)[number]['id']

export function fontFor(id: FontId) {
  return FONTS.find((font) => font.id === id) ?? FONTS[0]
}

/** A canvas font string. */
export function cssFont(id: FontId, size: number): string {
  const font = fontFor(id)
  return `${font.weight} ${size}px ${font.family}`
}

/**
 * Loads a font before letters are drawn with it, so the first drawing isn't in a fallback.
 * Resolves either way: a font that can't load just draws in the fallback.
 */
export async function loadFont(id: FontId): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  try {
    await document.fonts.load(cssFont(id, 32), 'AZaz09')
  } catch {
    // Drawn in the fallback font.
  }
}
