declare module 'gifenc' {
  export type Palette = number[][]

  export type QuantizeOptions = {
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
  }

  export type FrameOptions = {
    palette?: Palette
    delay?: number
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    colorDepth?: number
    dispose?: number
    first?: boolean
  }

  export type Encoder = {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array
}
