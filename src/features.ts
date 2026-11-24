/**
 * Feature flags, read from Vite env vars at build time.
 *
 * VITE_FACTORY_APP: "true" turns on the factory app (ASH-33): a 640 KB Wi-Fi + OTA downloader
 * that holding BOOT goes back to (ASH-32). It is off for now, which gives pictures more room.
 * Turn it on in Vercel (Settings → Environment Variables) or in .env.local, then rebuild.
 */
export const FACTORY_APP_ENABLED = import.meta.env.VITE_FACTORY_APP === 'true'
