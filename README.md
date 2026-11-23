# ESPER-MAGICIAN

A free, open-source site that previews pictures and examples on two small color screens:

- 2.8-inch (ESP32-2432S028R), 320×240
- 1.9-inch (Estardyn), 170×320

V1 is a simulator. It does not flash the device. In the browser you can:

- Pick one of four examples: Photo frame, Animation loop, Digital clock, Info card.
- Upload a JPEG, PNG, WebP, or GIF. Pictures are shown whole (`object-fit: contain`) with dark bars where the shape doesn't match the screen.
- Find past uploads under **My uploads**. They are saved in this browser's IndexedDB and never leave the device.
- Crop and rotate an upload for each screen. The original file is kept; the crop is saved as settings per screen, and GIFs keep playing.

`firmware/` holds an ESP-IDF app for the board that shows a picture or GIF on its screen. See [firmware/README.md](firmware/README.md) for how to build and flash it.

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
