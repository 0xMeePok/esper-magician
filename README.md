# ESPER-MAGICIAN

A free, open-source site that previews pictures and examples on two small color screens:

- 2.8-inch (ESP32-2432S028R), 320×240
- 1.9-inch (Estardyn), 170×320

V1 is a simulator. It does not flash the device. In the browser you can:

- Pick one of four examples: Photo frame, Animation loop, Digital clock, Info card.
- Upload a JPEG, PNG, WebP, or GIF. Pictures are shown whole (`object-fit: contain`) with dark bars where the shape doesn't match the screen.
- Find past uploads under **My uploads**. They are saved in this browser's IndexedDB and never leave the device.
- Crop and rotate an upload for each screen. The original file is kept; the crop is saved as settings per screen, and GIFs keep playing.
- If an upload is too big for the device's picture space (3.56 MB on a 4 MB board, see `firmware/partitions.media.csv`), pick Light, Balanced or Strong compression and preview the result on the screen. Pictures use MozJPEG (via jSquash) and GIFs use gifuct-js + gifenc, all in a Web Worker in the browser. The compressed copy is what gets flashed.

`firmware/` holds an ESP-IDF app that shows a picture or GIF on either screen (2.8-inch ESP32-2432S028R, or the 1.9-inch ST7789 on an ESP32 DevKit). See [firmware/README.md](firmware/README.md) for how to build and flash it.

## Install

```bash
npm install
```

## Dev server

```bash
npm run dev
```

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
| `VITE_FACTORY_APP` | off | Adds the 640 KB factory app (Wi-Fi + OTA downloader, ASH-33) that holding BOOT goes back to (ASH-32). Turning it on shrinks picture space from 3.56 MB to 2.93 MB. |

To turn the factory app on:

1. **On the live site:** in Vercel, open the project's **Settings → Environment Variables**, add `VITE_FACTORY_APP` with the value `true`, then redeploy.
2. **Locally:** put `VITE_FACTORY_APP=true` in `.env.local` and restart `npm run dev`.
3. **Firmware:** build the player with `firmware/partitions.factory.csv` instead of `firmware/partitions.media.csv`
   (`CONFIG_PARTITION_TABLE_CUSTOM_FILENAME` in `sdkconfig.defaults`), and flash the factory app at `0x10000`.

The two partition tables match `PLAYER_ONLY_LAYOUT` and `FACTORY_LAYOUT` in `src/flashLayout.ts`, and a test checks that they stay in step. Every device must use the same layout as the site that flashes it. Switching the flag on later means re-flashing devices once over USB.

