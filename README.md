# ESPER-MAGICIAN

A free, open-source site that previews pictures and examples on a small color screen, and puts them on it with one click:

- 1.9-inch ST7789, 170×320, on an ESP32 DevKit (ESP32-WROOM-32E, 4 MB flash)

In the browser you can:

- Pick one of four examples: Photo frame, Animation loop, Digital clock, Info card.
- Upload a JPEG, PNG, WebP, or GIF. Pictures are shown whole (`object-fit: contain`) with dark bars where the shape doesn't match the screen.
- Find past uploads under **My uploads**. They are saved in this browser's IndexedDB and never leave the device.
- Crop and rotate an upload. The original file is kept; the crop is saved as settings, and GIFs keep playing.
- If an upload is too big for the screen's picture space (2.18 MB, see `firmware/partitions.media.csv`), pick Light, Balanced or Strong compression and preview the result on the screen. Pictures use MozJPEG (via jSquash) and GIFs use gifuct-js + gifenc, all in a Web Worker in the browser.
- Click **Put it on my screen** (ASH-19). Everything except the Digital clock can go on the screen.
- On the **Text** page (navbar at the top), make a sign like an LED scroller: text in Plain, Neon or LED looks, nine kinds of lettering, any colour and size, placed and sized by dragging, turned to any angle, still, blinking or scrolling in any direction at the speed you pick, with pictures or a moving GIF behind. The screen can stand upright, sideways or upside down, and each design sets how bright the screen is. Layers always stay on the screen, so none can be lost off an edge. Designs are saved in this browser (IndexedDB) to open and change later, and sent to the screen like pictures.

## Text designs

The site doesn't send a GIF of scrolling text: that would be large and choppy. It draws each part of the design (a line of text, the LED dots, a picture) once into a small picture with see-through edges, a *sprite*, works out where it sits and how it moves on the screen, and sends those (`src/text/`). The player (1.6.0 and newer) moves and blinks the sprites itself, redrawing only what changed each step (`firmware/main/scene.c`), so text scrolls smoothly and a long message stays small. Anything behind the first moving part is drawn once into the background; a GIF at the back plays under the text.

The preview on the page uses the same sprites and the same timing code as the player (`src/text/sceneFormat.ts` mirrors `firmware/main/scene_format.c`), so it moves exactly like the screen. A screen with an older player needs one USB send to update before it takes designs over Wi-Fi; the site says so.

## Put it on my screen

**The first time, over USB.** Plug the screen in and click the button. Chrome or Edge shows its device list once; pick the board. The site installs the player and the picture with [esptool-js](https://github.com/espressif/esptool-js) (Espressif's own flasher) over Web Serial, restarts the screen, and asks for the Wi-Fi name and password. Those go to the screen over USB with [Improv Serial](https://www.improv-wifi.com/serial/), and the screen reports its address on the Wi-Fi, which the site remembers.

**Every time after, over Wi-Fi.** The site is on https and the screen serves plain http on the home network, which browsers normally block. Chrome and Edge allow it for requests marked as going to the local network ([Local Network Access](https://developer.chrome.com/blog/local-network-access), with a one-time permission prompt), so "Send over Wi-Fi" posts the picture to the screen straight from the page; the screen answers CORS for this site only (`firmware/main/web.c`). Where the browser won't allow that, the site offers "Send through the screen's page instead": it opens the screen's own page (`firmware/main/receiver.html`) in a small window and hands it the picture with `postMessage`. The computer has to be on the same Wi-Fi.

What gets sent is always made for the screen: a baseline JPEG, or a GIF, no bigger than 170×320. A compressed choice is sent exactly as previewed. Anything else (an upload that fits, an example, the Info card drawn on a canvas) goes through the same compressor at the lightest strength that fits. Nothing is uploaded to a server.

The firmware the site installs lives in `public/firmware/esper-1.9/<board>/`, one build per ESP32 board (38-pin and 30-pin DevKit), each with an ESP Web Tools-style manifest the site checks every download against. The site asks which board the screen is wired to before the first USB install, and shows the screen's serial output live, with what it reports about the picture. Rebuild it with `firmware/tools/build_web.sh` after changing the firmware. See [firmware/README.md](firmware/README.md).

## Install

```bash
npm install
```

## Dev server

```bash
npm run dev
```

## Tests

```bash
npm test
```

`src/flash/deviceFormat.test.ts` compiles the player's own C code (the GIF decoder, the media header check and Improv Serial) with the computer's C compiler and runs it on exactly what the site produces; `src/text/sceneFormat.test.ts` does the same for text designs, checking the player draws every pixel at every moment as the editor does. They are skipped where there is no `cc`.

## Production build

```bash
npm run build
```

The production build writes a static site to `dist/`. Host that output on Vercel as a static SPA. `vercel.json` sends unknown paths to `index.html`; files in `public/` are still served as static assets.

Curated example metadata and assets go in `public/examples/` and are served from `/examples/`.

## Feature flags

Flags are Vite env vars, read at build time in `src/features.ts`.

| Flag | Default | What it does |
| --- | --- | --- |
| `VITE_FACTORY_APP` | off | Adds the 640 KB factory app (Wi-Fi + OTA downloader, ASH-33) that holding BOOT goes back to (ASH-32). It uses a different layout (one player slot plus the factory app, 2.43 MB of pictures). |

The factory app itself isn't built yet (ASH-33). With the flag on, the site uses the factory layout, and **Put it on my screen** refuses to install until firmware for that layout is in `public/firmware/`.

To turn the factory app on:

1. **On the live site:** in Vercel, open the project's **Settings → Environment Variables**, add `VITE_FACTORY_APP` with the value `true`, then redeploy.
2. **Locally:** put `VITE_FACTORY_APP=true` in `.env.local` and restart `npm run dev`.
3. **Firmware:** build the player with `firmware/partitions.factory.csv` instead of `firmware/partitions.media.csv`
   (`CONFIG_PARTITION_TABLE_CUSTOM_FILENAME` in `sdkconfig.defaults`), and flash the factory app at `0x10000`.

The two partition tables match `PLAYER_LAYOUT` and `FACTORY_LAYOUT` in `src/flashLayout.ts`, and a test checks that they stay in step. Every device must use the same layout as the site that flashes it. Switching the flag later means re-installing each screen once over USB.
