import { TooBigError } from './deviceAsset.ts'
import { UsbError } from './usb.ts'
import { WifiError } from './wifi.ts'

export const FLASH_COPY = {
  button: 'Put it on my screen',
  helperUsb: 'Plug your screen in with a USB cable. The first time, Chrome asks you to pick it.',
  helperWifi: 'Sends over Wi-Fi to your screen.',
  useUsb: 'Use USB instead',
  needsChrome:
    'Setting up your screen the first time needs Chrome or Edge on a computer, with the screen plugged in by USB. After that, changes go over Wi-Fi.',
  nothing: 'Pick an example or upload a picture first.',
  clock: "The clock can't go on the screen yet. Pick another example or upload a picture.",
  preparing: 'Getting your picture ready…',
  installing: 'Installing on your screen…',
  sendingWifi: 'Sending over Wi-Fi…',
  restarting: 'Restarting your screen…',
  joining: 'Joining your Wi-Fi…',
  done: 'Done. Your screen is showing it now.',
  doneWifi: 'Next time it changes over Wi-Fi.',
  doneNoWifi: 'To change it over Wi-Fi next time, plug it in again and set up Wi-Fi.',
  wifiHeading: 'Change pictures over Wi-Fi next time',
  wifiHelper:
    "Your screen joins your home Wi-Fi (2.4 GHz), so you won't need the cable again. The details go straight to the screen over USB.",
  wifiName: 'Wi-Fi name',
  wifiPassword: 'Password',
  wifiConnect: 'Connect',
  wifiSkip: 'Not now',
  wifiFailed: "Your screen couldn't join that Wi-Fi. Check the name and password. It needs a 2.4 GHz network.",
  tryAgain: 'Try again',
} as const

export type FlashProblem =
  | 'no-serial'
  | 'popup-blocked'
  | 'too-big'
  | 'busy'
  | 'no-response'
  | 'wrong-chip'
  | 'unplugged'
  | 'unreachable'
  | 'other-screen'
  | 'failed'

const MESSAGES: Record<FlashProblem, string> = {
  'no-serial': FLASH_COPY.needsChrome,
  'popup-blocked':
    'Your browser blocked the small window that talks to your screen. Allow pop-ups for this site, then try again.',
  'too-big': 'This is too big for your screen, even with strong compression.',
  busy: "Another app is using your screen's USB connection. Close it (for example a serial monitor), then try again.",
  'no-response':
    "Your screen didn't answer. Unplug it, plug it back in, and try again. If that doesn't work, hold the BOOT button on the board while you click.",
  'wrong-chip': "That device isn't an ESPER screen. Pick the ESP32 board in the list.",
  unplugged: 'The screen was unplugged. Plug it back in and try again.',
  unreachable:
    "Couldn't reach your screen over Wi-Fi. Check it's switched on and on the same Wi-Fi as this computer, or plug it in with USB.",
  'other-screen': "The screen at that address isn't a 1.9-inch ESPER screen. Set it up again with USB.",
  failed: "The picture didn't reach your screen. Try again.",
}

export function problemMessage(problem: FlashProblem, detail?: string): string {
  return problem === 'failed' && detail ? detail : MESSAGES[problem]
}

/** Turns anything thrown during a send into a plain problem. */
export function problemFor(error: unknown): { problem: FlashProblem; detail?: string } {
  if (error instanceof TooBigError) return { problem: 'too-big' }
  if (error instanceof UsbError) return { problem: error.problem }
  if (error instanceof WifiError) {
    if (error.problem === 'blocked') return { problem: 'popup-blocked' }
    if (error.problem === 'failed') return { problem: 'failed', detail: error.message === 'failed' ? undefined : error.message }
    return { problem: error.problem }
  }
  return { problem: 'failed', detail: error instanceof Error ? error.message : undefined }
}

/** Wi-Fi problems are fixed by setting the screen up again over USB. */
export function suggestsUsb(problem: FlashProblem): boolean {
  return problem === 'unreachable' || problem === 'other-screen' || problem === 'failed'
}
