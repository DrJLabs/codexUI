export type AutomationScheduleFrequency =
  | 'minute_interval'
  | 'hourly'
  | 'hour_interval'
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'custom'

export type AutomationRruleClassification = {
  frequency: AutomationScheduleFrequency
  scheduleKind: 'interval' | 'wall_clock' | 'custom'
  label: string
  normalizedRrule: string
  rawRrule: string
  time: string | null
  weekday: string | null
  intervalCount: number | null
}

const WEEKDAY_LABELS: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

const WEEKDAY_CODES: Record<string, string> = {
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU',
}

const WEEKDAY_SET = 'MO,TU,WE,TH,FR'
const WEEKEND_SET = 'SA,SU'
const ALL_DAYS_SET = 'MO,TU,WE,TH,FR,SA,SU'
const DESKTOP_ALL_DAYS_SET = 'SU,MO,TU,WE,TH,FR,SA'
const TIME_INPUT_ERROR = 'Expected time in HH:MM format from 00:00 through 23:59'

export function describeAutomationSchedule(rrule: string): string {
  return classifyAutomationRrule(rrule).label
}

export function classifyAutomationRrule(rrule: string): AutomationRruleClassification {
  const rawRrule = rrule
  const normalizedRrule = normalizeRrulePrefix(rrule)
  const parts = parseRrule(normalizedRrule)
  const hour = parseNumberPart(parts.BYHOUR)
  const minute = parseNumberPart(parts.BYMINUTE)
  const interval = parsePositiveInteger(parts.INTERVAL ?? '1')
  const time = hour !== null && minute !== null && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    : null
  const formattedTime = time ? formatTime(hour ?? 0, minute ?? 0) : null
  const hasDefaultInterval = !parts.INTERVAL || parts.INTERVAL === '1'

  if (
    parts.FREQ === 'MINUTELY' &&
    interval !== null &&
    hasOnlyKeys(parts, parts.INTERVAL ? ['FREQ', 'INTERVAL'] : ['FREQ'])
  ) {
    return {
      frequency: 'minute_interval',
      scheduleKind: 'interval',
      label: interval === 1 ? 'Every minute' : `Every ${interval} minutes`,
      normalizedRrule,
      rawRrule,
      time: null,
      weekday: null,
      intervalCount: interval,
    }
  }

  if (
    parts.FREQ === 'HOURLY' &&
    interval !== null &&
    hasOnlyKeys(parts, parts.INTERVAL ? ['FREQ', 'INTERVAL'] : ['FREQ'])
  ) {
    return {
      frequency: 'hour_interval',
      scheduleKind: 'interval',
      label: interval === 1 ? 'Every hour' : `Every ${interval} hours`,
      normalizedRrule,
      rawRrule,
      time: null,
      weekday: null,
      intervalCount: interval,
    }
  }

  if (
    parts.FREQ === 'HOURLY' &&
    interval === 1 &&
    parts.BYMINUTE === '0' &&
    (!parts.BYDAY || normalizeBydaySet(parts.BYDAY) === ALL_DAYS_SET) &&
    hasOnlyKeys(parts, parts.BYDAY ? ['BYDAY', 'BYMINUTE', 'FREQ', 'INTERVAL'] : ['BYMINUTE', 'FREQ', 'INTERVAL'])
  ) {
    return {
      frequency: 'hourly',
      scheduleKind: 'wall_clock',
      label: 'Hourly',
      normalizedRrule,
      rawRrule,
      time: null,
      weekday: null,
      intervalCount: null,
    }
  }

  if (
    parts.FREQ === 'DAILY' &&
    time &&
    hasDefaultInterval &&
    hasOnlyKeys(parts, parts.INTERVAL ? ['BYHOUR', 'BYMINUTE', 'FREQ', 'INTERVAL'] : ['BYHOUR', 'BYMINUTE', 'FREQ'])
  ) {
    return {
      frequency: 'daily',
      scheduleKind: 'wall_clock',
      label: `Daily at ${formattedTime}`,
      normalizedRrule,
      rawRrule,
      time,
      weekday: null,
      intervalCount: null,
    }
  }

  if (
    parts.FREQ === 'WEEKLY' &&
    time &&
    parts.BYDAY &&
    hasDefaultInterval &&
    hasOnlyKeys(parts, parts.INTERVAL ? ['BYDAY', 'BYHOUR', 'BYMINUTE', 'FREQ', 'INTERVAL'] : ['BYDAY', 'BYHOUR', 'BYMINUTE', 'FREQ'])
  ) {
    const bydaySet = normalizeBydaySet(parts.BYDAY)
    if (bydaySet === WEEKDAY_SET) {
      return {
        frequency: 'weekdays',
        scheduleKind: 'wall_clock',
        label: `Weekdays at ${formattedTime}`,
        normalizedRrule,
        rawRrule,
        time,
        weekday: null,
        intervalCount: null,
      }
    }
    if (bydaySet === WEEKEND_SET) {
      return {
        frequency: 'weekends',
        scheduleKind: 'wall_clock',
        label: `Weekends at ${formattedTime}`,
        normalizedRrule,
        rawRrule,
        time,
        weekday: null,
        intervalCount: null,
      }
    }
    if (WEEKDAY_LABELS[parts.BYDAY]) {
      return {
        frequency: 'weekly',
        scheduleKind: 'wall_clock',
        label: `Weekly on ${WEEKDAY_LABELS[parts.BYDAY]} at ${formattedTime}`,
        normalizedRrule,
        rawRrule,
        time,
        weekday: parts.BYDAY,
        intervalCount: null,
      }
    }
  }

  return {
    frequency: 'custom',
    scheduleKind: 'custom',
    label: `Custom schedule: ${rawRrule}`,
    normalizedRrule,
    rawRrule,
    time,
    weekday: null,
    intervalCount: null,
  }
}

export function buildMinuteIntervalRrule(minutes: number): string {
  const interval = readIntervalCount(minutes, 'minutes')
  return `FREQ=MINUTELY;INTERVAL=${interval}`
}

export function buildHourlyIntervalRrule(hours: number): string {
  const interval = readIntervalCount(hours, 'hours')
  return `FREQ=HOURLY;INTERVAL=${interval}`
}

export function buildHourlyRrule(): string {
  return `FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=${DESKTOP_ALL_DAYS_SET}`
}

export function buildDailyRrule(time: string): string {
  const { hour, minute } = parseTimeInput(time)
  return `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`
}

export function buildWeekdaysRrule(time: string): string {
  return buildWeeklyDaysRrule(['MO', 'TU', 'WE', 'TH', 'FR'], time)
}

export function buildWeekendsRrule(time: string): string {
  return buildWeeklyDaysRrule(['SA', 'SU'], time)
}

export function buildWeeklyRrule(day: string, time: string): string {
  return buildWeeklyDaysRrule([normalizeWeekday(day)], time)
}

function buildWeeklyDaysRrule(days: string[], time: string): string {
  const { hour, minute } = parseTimeInput(time)
  return `FREQ=WEEKLY;BYDAY=${days.join(',')};BYHOUR=${hour};BYMINUTE=${minute}`
}

function normalizeRrulePrefix(rrule: string): string {
  const trimmed = rrule.trim()
  return trimmed.startsWith('RRULE:') ? trimmed.slice('RRULE:'.length) : trimmed
}

function parseRrule(rrule: string): Record<string, string> {
  return rrule.split(';').reduce<Record<string, string>>((parts, rawPart) => {
    const separator = rawPart.indexOf('=')
    if (separator <= 0) return parts
    const key = rawPart.slice(0, separator).trim().toUpperCase()
    const value = rawPart.slice(separator + 1).trim().toUpperCase()
    if (key && value) parts[key] = value
    return parts
  }, {})
}

function parseNumberPart(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = parseNumberPart(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function parseTimeInput(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) throw new Error(TIME_INPUT_ERROR)

  const hour = Number.parseInt(match[1], 10)
  const minute = Number.parseInt(match[2], 10)
  if (hour > 23 || minute > 59) throw new Error(TIME_INPUT_ERROR)

  return { hour, minute }
}

function readIntervalCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Expected ${field} interval to be a positive whole number`)
  }
  return value
}

function normalizeWeekday(day: string): string {
  const trimmed = day.trim()
  const upper = trimmed.toUpperCase()
  if (WEEKDAY_LABELS[upper]) return upper
  return WEEKDAY_CODES[trimmed.toLowerCase()] ?? upper
}

function normalizeBydaySet(value: string): string {
  return value
    .split(',')
    .map((day) => day.trim().toUpperCase())
    .filter((day) => Boolean(WEEKDAY_LABELS[day]))
    .sort((a, b) => weekdayOrder(a) - weekdayOrder(b))
    .join(',')
}

function weekdayOrder(day: string): number {
  return ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(day)
}

function hasOnlyKeys(parts: Record<string, string>, expectedKeys: string[]): boolean {
  const keys = Object.keys(parts).sort()
  const expected = [...expectedKeys].sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`
}
