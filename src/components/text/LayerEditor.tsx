import { useId } from 'react'
import {
  DOTS,
  isQuarterTurn,
  SIZES,
  SPEEDS,
  type Box,
  type Design,
  type Layer,
  type PictureLayer,
  type TextLayer,
} from '../../text/design.ts'
import { FONTS } from '../../text/fonts.ts'
import { Choice, ColorField, NumberField, SelectField, Slider } from './controls.tsx'

type Props = {
  design: Design
  layer: Layer
  /** The design's own size, for "fill" and "centre". */
  size: { width: number; height: number }
  onChange: (patch: Partial<Layer>) => void
  onReplacePicture: () => void
}

const TURNS = [0, 90, 180, 270] as const

export default function LayerEditor({ design, layer, size, onChange, onReplacePicture }: Props) {
  return (
    <section className="panel layer-editor" aria-label={layer.kind === 'text' ? 'Text settings' : 'Picture settings'}>
      <h2>{layer.kind === 'text' ? 'Text' : 'Picture'}</h2>
      {layer.kind === 'text' ? (
        <TextSettings layer={layer} onChange={onChange} />
      ) : (
        <PictureSettings design={design} layer={layer} onChange={onChange} onReplace={onReplacePicture} />
      )}
      <Placement layer={layer} size={size} onChange={onChange} />
    </section>
  )
}

function TextSettings({ layer, onChange }: { layer: TextLayer; onChange: (patch: Partial<TextLayer>) => void }) {
  const textId = useId()
  const scrolling = layer.scroll !== 'none'
  const sideways = layer.scroll === 'left' || layer.scroll === 'right'
  return (
    <div className="layer-editor__group">
      <div className="field">
        <label className="field__label" htmlFor={textId}>
          Words
        </label>
        <textarea
          id={textId}
          rows={3}
          value={layer.text}
          placeholder="Type your message"
          onChange={(event) => onChange({ text: event.target.value })}
        />
        {sideways && layer.text.includes('\n') ? <p className="helper">Sideways scrolling puts every line in one row.</p> : null}
      </div>
      <Choice
        label="Look"
        value={layer.effect}
        options={[
          { value: 'plain', label: 'Plain' },
          { value: 'neon', label: 'Neon' },
          { value: 'led', label: 'LED' },
        ]}
        onChange={(effect) => onChange({ effect })}
      />
      <SelectField
        label="Lettering"
        value={layer.font}
        options={FONTS.map((font) => ({ value: font.id, label: font.label }))}
        onChange={(font) => onChange({ font })}
      />
      <div className="field-row">
        <ColorField label="Colour" value={layer.color} onChange={(color) => onChange({ color })} />
      </div>
      <Slider label="Size" value={layer.size} min={SIZES.min} max={SIZES.max} unit="px" onChange={(size) => onChange({ size })} />
      {layer.effect === 'led' ? (
        <Slider label="LED dot spacing" value={layer.dot} min={DOTS.min} max={DOTS.max} unit="px" onChange={(dot) => onChange({ dot })} />
      ) : null}
      <Choice
        label="Movement"
        value={layer.scroll}
        options={[
          { value: 'none', label: 'Still' },
          { value: 'left', label: '←', title: 'Scroll left' },
          { value: 'right', label: '→', title: 'Scroll right' },
          { value: 'up', label: '↑', title: 'Scroll up' },
          { value: 'down', label: '↓', title: 'Scroll down' },
        ]}
        onChange={(scroll) =>
          onChange(scroll !== 'none' && !isQuarterTurn(layer.rotation) ? { scroll, rotation: Math.round(layer.rotation / 90) * 90 } : { scroll })
        }
      />
      {scrolling ? (
        <>
          <Slider label="Speed" value={layer.speed} min={SPEEDS.min} max={SPEEDS.max} unit="px/s" onChange={(speed) => onChange({ speed })} />
          <Choice
            label="Repeat"
            value={layer.spacing}
            options={[
              { value: 'apart', label: 'Once it has gone' },
              { value: 'close', label: 'Close behind' },
            ]}
            onChange={(spacing) => onChange({ spacing })}
          />
        </>
      ) : null}
      <Choice
        label="Blink"
        value={layer.blink}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'slow', label: 'Slow' },
          { value: 'fast', label: 'Fast' },
        ]}
        onChange={(blink) => onChange({ blink })}
      />
      {!sideways ? (
        <Choice
          label="Line up"
          value={layer.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(align) => onChange({ align })}
        />
      ) : null}
    </div>
  )
}

function PictureSettings({
  design,
  layer,
  onChange,
  onReplace,
}: {
  design: Design
  layer: PictureLayer
  onChange: (patch: Partial<PictureLayer>) => void
  onReplace: () => void
}) {
  const media = design.media.find((item) => item.id === layer.mediaId)
  const atBack = design.layers[0]?.id === layer.id
  const moving = Boolean(media?.animated) && atBack
  return (
    <div className="layer-editor__group">
      <p className="layer-editor__file">
        <span>{media?.name ?? 'Picture'}</span>
        <button type="button" className="link-button" onClick={onReplace}>
          Replace
        </button>
      </p>
      {media?.animated && !atBack ? (
        <p className="helper">Only a GIF at the very back moves; this one shows its first frame. Send it to the back to play it.</p>
      ) : null}
      <Choice
        label="Fit"
        value={layer.fit}
        options={[
          { value: 'cover', label: 'Fill' },
          { value: 'contain', label: 'Fit inside' },
          { value: 'stretch', label: 'Stretch' },
        ]}
        onChange={(fit) => onChange({ fit })}
      />
      <Choice
        label="Blink"
        value={moving ? 'off' : layer.blink}
        disabled={moving}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'slow', label: 'Slow' },
          { value: 'fast', label: 'Fast' },
        ]}
        onChange={(blink) => onChange({ blink })}
      />
    </div>
  )
}

function Placement({ layer, size, onChange }: { layer: Layer; size: { width: number; height: number }; onChange: (patch: Partial<Layer>) => void }) {
  const quarterOnly = layer.kind === 'text' && layer.scroll !== 'none'
  const set = (patch: Partial<Box>) => onChange(patch)
  return (
    <div className="layer-editor__group">
      <h3 className="layer-editor__heading">Place</h3>
      <div className="field-grid">
        <NumberField label="Left" value={layer.x} onChange={(x) => set({ x })} />
        <NumberField label="Top" value={layer.y} onChange={(y) => set({ y })} />
        <NumberField label="Width" value={layer.width} min={8} onChange={(width) => set({ width })} />
        <NumberField label="Height" value={layer.height} min={8} onChange={(height) => set({ height })} />
      </div>
      <div className="button-row">
        <button type="button" className="button button-file button-small" onClick={() => set({ x: Math.round((size.width - layer.width) / 2), y: Math.round((size.height - layer.height) / 2) })}>
          Centre
        </button>
        <button type="button" className="button button-file button-small" onClick={() => set({ x: 0, width: size.width })}>
          Full width
        </button>
        <button type="button" className="button button-file button-small" onClick={() => set({ x: 0, y: 0, width: size.width, height: size.height })}>
          Whole screen
        </button>
      </div>
      <Choice
        label="Turn"
        value={String(TURNS.find((turn) => turn === (((layer.rotation % 360) + 360) % 360)) ?? 'other')}
        options={TURNS.map((turn) => ({ value: String(turn), label: `${turn}°` }))}
        onChange={(value) => onChange({ rotation: Number(value) > 180 ? Number(value) - 360 : Number(value) })}
      />
      {quarterOnly ? (
        <p className="helper">Scrolling text turns in quarter turns.</p>
      ) : (
        <Slider label="Tilt" value={Math.round(layer.rotation)} min={-180} max={180} unit="°" onChange={(rotation) => onChange({ rotation })} />
      )}
    </div>
  )
}
