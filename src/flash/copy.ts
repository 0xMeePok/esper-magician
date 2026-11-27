import { TooBigError } from './deviceAsset.ts'
import { UsbError } from './usb.ts'
import { WifiError } from './wifi.ts'

export const FLASH_COPY = {
  sendWifi: 'Send over Wi-Fi',
  sendUsb: 'Send over USB',
  helperUsb: 'Plug your screen in with a USB cable. The first time, Chrome asks you to pick it.',
  helperWifi: 'Wi-Fi sends straight from this page. USB installs everything, for the first time or if Wi-Fi isn’t working.',
  connectFirst: 'Connect to your screen above to send over Wi-Fi.',
  connectHeading: 'Your screen on Wi-Fi',
  connectHelper:
    'Enter its name or address, like ESPER-49F5C0 (its setup Wi-Fi name) or 192.168.0.16. New screen? Plug it into power, join its ESPER Wi-Fi on your phone and pick your home Wi-Fi; the setup page brings you back here.',
  connectLabel: 'Screen name or address',
  connectPlaceholder: 'ESPER-49F5C0',
  connect: 'Connect',
  connecting: 'Looking for your screen…',
  connectBad: "That doesn't look like a screen name or address. Try its Wi-Fi name, like ESPER-49F5C0, or an address like 192.168.0.16.",
  connectUnreachable:
    "Couldn't find your screen from this page. Check it's on and on the same Wi-Fi as this computer, and allow this site to reach devices on your local network if the browser asks.",
  connectOther: "There's a different kind of screen at that address.",
  keepAddress: 'Use this address anyway',
  keepAddressHelper: "For browsers that won't let this page reach the screen: pictures then go through the screen's own page.",
  sendingTo: 'Wi-Fi sends go to',
  change: 'Change',
  usbSummary: 'Install over USB',
  usbSummaryHelper: 'Only needed for a screen without the ESPER firmware, or to repair one.',
  dismiss: 'Dismiss',
  screenPage: 'Send through the screen’s page instead',
  screenPageHelper: 'Opens a small window served by your screen, for browsers that can’t reach it from this page.',
  needsChrome:
    "Installing over USB needs Chrome, Edge or Brave on a computer. A screen that already has the ESPER firmware doesn't need it: connect to it over Wi-Fi instead.",
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
  boardHeading: 'Which board is your screen wired to?',
  boardHelper: 'Each board gets firmware made for its wiring. The wrong one leaves the screen dark.',
  pickBoard: 'Pick the board your screen is wired to first.',
  serialHeading: "Your screen's serial output",
  serialHelper:
    "Read live from your screen's USB port at 115200 baud: esptool lines while installing, then the screen's own boot log.",
  serialChecksHeading: 'What the screen reported',
  serialChecksNote:
    "The ESP32 can only report what it sent: nothing is wired back from the screen, so it can't see the glass. If these are ticked but the screen stays dark, the problem is the wiring, power or the screen itself.",
  serialEmpty: 'Nothing received yet.',
  serialWatch: 'Show serial output',
  serialRestart: 'Restart screen',
  serialStop: 'Stop',
  serialListening: 'Listening to your screen…',
  serialViewLabel: 'Which lines to show',
  serialViewWifi: 'Wi-Fi lines',
  serialViewAll: 'Everything',
  serialNoWifiLines: 'No Wi-Fi lines yet. Pick “Everything” to see the rest.',
  screenWouldShow: 'What your screen would show',
  wifiWaiting: 'Waiting for Wi-Fi messages from your screen…',
  setupMode: 'Set-up mode: your screen has its own Wi-Fi network.',
  setupNoInternet:
    "That network has no internet, so this site won't load while you're on it. Switch back to your home Wi-Fi when the setup page says it's done.",
  useThisScreen: 'Send to this screen over Wi-Fi',
  screenInUse: 'Wi-Fi sends go to this screen.',
} as const

export type FlashProblem =
  | 'no-serial'
  | 'popup-blocked'
  | 'too-big'
  | 'busy'
  | 'no-response'
  | 'wrong-chip'
  | 'unplugged'
  | 'verify-failed'
  | 'no-board'
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
  'verify-failed':
    "What's in your screen's memory doesn't match what was sent, so the install didn't take. Try again; if it keeps happening, try another USB cable.",
  'no-board': FLASH_COPY.pickBoard,
  unreachable:
    "Couldn't reach your screen over Wi-Fi. Check it's switched on and on the same Wi-Fi as this computer. In Chrome or Edge, allow this site to reach devices on your local network when asked.",
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
