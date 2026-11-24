/** The one screen ESPER supports: a 1.9-inch ST7789 on an ESP32 DevKit (ASH-19). */
export const screens = [
  {
    id: '1.9',
    title: '1.9-inch screen',
    caption: 'Estardyn · 170 × 320',
    bezelCaption: 'Your screen (170 × 320)',
    orientation: 'portrait',
    width: 170,
    height: 320,
  },
] as const

export type Screen = (typeof screens)[number]
export type ScreenId = Screen['id']

export const SCREEN: Screen = screens[0]
export const SCREEN_ID: ScreenId = SCREEN.id

export function screenFor(id: ScreenId): Screen {
  return screens.find((screen) => screen.id === id) ?? SCREEN
}
