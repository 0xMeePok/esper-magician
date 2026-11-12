# ESPER-MAGICIAN

A free, open-source site for the ESP32-2432S028R.

V1 is a 320×240 simulator. It does not flash the device.

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
