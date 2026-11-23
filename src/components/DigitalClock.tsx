import { useEffect, useState } from 'react'
import { clockFace } from '../clock.ts'
import { clockSizes } from '../exampleLayout.ts'

type DigitalClockProps = {
  width: number
  height: number
  /** Fixed time for tests. When set, the clock does not tick. */
  now?: Date
}

export default function DigitalClock({ width, height, now }: DigitalClockProps) {
  const [current, setCurrent] = useState(() => now ?? new Date())

  useEffect(() => {
    if (now) return
    // Ticks every second: seconds show on 24-hour locales, and minutes must not lag on 12-hour.
    const id = window.setInterval(() => setCurrent(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [now])

  const face = clockFace(now ?? current)
  const sizes = clockSizes(width)

  return (
    <div className="example-clock" style={{ width, height }}>
      <span className="example-clock__time" style={{ fontSize: sizes.time }}>
        {face.time}
      </span>
      <span className="example-clock__detail" style={{ fontSize: sizes.detail }}>
        {face.detail}
      </span>
      <span className="example-clock__date" style={{ fontSize: sizes.date }}>
        {face.date}
      </span>
    </div>
  )
}
