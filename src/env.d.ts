/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" turns on the factory app partition. See src/features.ts. */
  readonly VITE_FACTORY_APP?: string
}
