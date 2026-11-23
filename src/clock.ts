export type ClockFace = {
  /** HH:MM */
  time: string
  /** AM/PM on 12-hour locales, seconds on 24-hour locales. */
  detail: string
  /** e.g. "Thu 12 Nov" */
  date: string
  /** True when `detail` shows seconds, so the clock has to tick every second. */
  showsSeconds: boolean
}

export function usesTwelveHourClock(locale?: string): boolean {
  try {
    const options = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
    if (options.hourCycle) return options.hourCycle === 'h11' || options.hourCycle === 'h12'
    return options.hour12 === true
  } catch {
    return false
  }
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? ''
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Reads the browser's local time. The locale decides 12-hour (AM/PM) or 24-hour (seconds). */
export function clockFace(now: Date, locale?: string): ClockFace {
  const twelveHour = usesTwelveHourClock(locale)
  const timeParts = new Intl.DateTimeFormat(locale, {
    hour: twelveHour ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: twelveHour,
  }).formatToParts(now)
  const dateParts = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(now)

  const hour = part(timeParts, 'hour') || pad(now.getHours())
  const minute = part(timeParts, 'minute') || pad(now.getMinutes())
  const dayPeriod = part(timeParts, 'dayPeriod')

  return {
    time: `${hour}:${minute}`,
    detail: twelveHour ? dayPeriod || (now.getHours() < 12 ? 'AM' : 'PM') : pad(now.getSeconds()),
    date: [part(dateParts, 'weekday'), part(dateParts, 'day'), part(dateParts, 'month')]
      .filter(Boolean)
      .join(' '),
    showsSeconds: !twelveHour,
  }
}
