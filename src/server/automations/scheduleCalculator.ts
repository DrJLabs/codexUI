import { normalizeAutomationRrule } from './schema.js'

export type SchedulerDecision = {
  due: boolean
  dueAtIso: string | null
  nextDueAtIso: string | null
  missedRunPolicy: 'one_catch_up'
  unsupportedReason: string | null
}

export type RruleScheduleExecutionKind = {
  scheduleKind: 'interval' | 'wall_clock'
  intervalMs: number | null
}

type SupportedFrequency = 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY'
type Frequency = SupportedFrequency | 'MONTHLY' | 'YEARLY'
type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

type ParsedRrule = {
  freq: Frequency
  interval: number
  byhour: number[] | null
  byminute: number[] | null
  byday: Weekday[] | null
}
type SupportedRrule = ParsedRrule & { freq: SupportedFrequency }

const SUPPORTED_KEYS = new Set(['FREQ', 'INTERVAL', 'BYHOUR', 'BYMINUTE', 'BYDAY'])
const SUPPORTED_FREQUENCIES = new Set(['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
const WEEKDAY_INDEX: Record<Weekday, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

export function classifyRruleScheduleKind(rrule: string): RruleScheduleExecutionKind {
  const parsed = parseRrule(rrule)
  if (parsed.freq === 'MINUTELY' && parsed.byhour === null && parsed.byminute === null && parsed.byday === null) {
    return { scheduleKind: 'interval', intervalMs: parsed.interval * 60_000 }
  }
  if (parsed.freq === 'HOURLY' && parsed.byhour === null && parsed.byminute === null && parsed.byday === null) {
    return { scheduleKind: 'interval', intervalMs: parsed.interval * 60 * 60_000 }
  }
  return { scheduleKind: 'wall_clock', intervalMs: null }
}

export function evaluateRruleSchedule(input: {
  rrule: string
  nowIso: string
  nextDueAtIso: string | null
  anchorIso: string
}): SchedulerDecision {
  const parsed = parseRrule(input.rrule)
  if (parsed.freq === 'MONTHLY' || parsed.freq === 'YEARLY') {
    return {
      due: false,
      dueAtIso: null,
      nextDueAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: `Scheduler execution for FREQ=${parsed.freq} is not implemented`,
    }
  }
  const supported = parsed as SupportedRrule

  const now = parseIso(input.nowIso, 'nowIso')
  const anchor = parseIso(input.anchorIso, 'anchorIso')
  const persistedDue = input.nextDueAtIso === null ? null : parseIso(input.nextDueAtIso, 'nextDueAtIso')
  const candidateDue = persistedDue ?? findNextOccurrence(supported, anchor, anchor)
  if (candidateDue.getTime() <= now.getTime()) {
    return {
      due: true,
      dueAtIso: candidateDue.toISOString(),
      nextDueAtIso: findNextOccurrence(supported, anchor, now).toISOString(),
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
    }
  }

  return {
    due: false,
    dueAtIso: null,
    nextDueAtIso: candidateDue.toISOString(),
    missedRunPolicy: 'one_catch_up',
    unsupportedReason: null,
  }
}

function parseRrule(rrule: string): ParsedRrule {
  try {
    const values = new Map<string, string>()
    for (const rawPart of normalizeAutomationRrule(rrule).split(';')) {
      const separator = rawPart.indexOf('=')
      if (separator <= 0 || separator === rawPart.length - 1) throw new Error('invalid RRULE part')
      const key = rawPart.slice(0, separator).trim()
      const value = rawPart.slice(separator + 1).trim()
      if (!SUPPORTED_KEYS.has(key)) throw new Error(`unsupported key ${key}`)
      if (values.has(key)) throw new Error(`duplicate key ${key}`)
      values.set(key, value)
    }

    const freqValue = values.get('FREQ')
    if (!freqValue || !SUPPORTED_FREQUENCIES.has(freqValue)) throw new Error(`unsupported FREQ ${freqValue ?? ''}`.trim())
    const intervalValue = values.get('INTERVAL') ?? '1'
    const interval = Number(intervalValue)
    if (!/^[1-9]\d*$/u.test(intervalValue) || !Number.isSafeInteger(interval)) throw new Error('invalid INTERVAL')

    return {
      freq: freqValue as Frequency,
      interval,
      byhour: parseNumberList(values.get('BYHOUR'), 0, 23, 'BYHOUR'),
      byminute: parseNumberList(values.get('BYMINUTE'), 0, 59, 'BYMINUTE'),
      byday: parseByday(values.get('BYDAY')),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid RRULE'
    throw new Error(`Unsupported automation RRULE for scheduler: ${message}`)
  }
}

function parseNumberList(value: string | undefined, min: number, max: number, field: string): number[] | null {
  if (!value) return null
  const parts = value.split(',')
  if (!parts.every((part) => /^\d+$/u.test(part) && Number(part) >= min && Number(part) <= max)) {
    throw new Error(`invalid ${field}`)
  }
  return [...new Set(parts.map((part) => Number(part)))].sort((a, b) => a - b)
}

function parseByday(value: string | undefined): Weekday[] | null {
  if (!value) return null
  const parts = value.split(',')
  if (!parts.every((part): part is Weekday => Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, part))) throw new Error('invalid BYDAY')
  return [...new Set(parts)]
}

function parseIso(value: string, field: string): Date {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`Unsupported automation RRULE for scheduler: invalid ${field}`)
  return new Date(timestamp)
}

function findNextOccurrence(rrule: SupportedRrule, anchor: Date, after: Date): Date {
  const start = roundDownToMinute(new Date(Math.max(anchor.getTime(), after.getTime()) + 60_000))
  const searchEnd = new Date(start.getTime() + 10 * 366 * 24 * 60 * 60_000)

  if (rrule.freq === 'MINUTELY') {
    const anchorMinute = roundDownToMinute(anchor)
    const startOffset = Math.max(1, Math.ceil(wholeMinutesBetween(anchorMinute, start) / rrule.interval) * rrule.interval)
    for (let offset = startOffset; ; offset += rrule.interval) {
      const candidate = new Date(anchorMinute.getTime() + offset * 60_000)
      if (candidate.getTime() > searchEnd.getTime()) break
      if (candidate.getTime() > after.getTime() && matchesOccurrence(candidate, anchor, rrule)) return candidate
    }
    throw new Error('Unsupported automation RRULE for scheduler: no occurrence found in search window')
  }

  if (rrule.freq === 'HOURLY') {
    for (let bucket = roundDownToHour(start); bucket.getTime() <= searchEnd.getTime(); bucket = new Date(bucket.getTime() + 60 * 60_000)) {
      const minutes = rrule.byminute ?? [roundDownToMinute(anchor).getUTCMinutes()]
      for (const minute of minutes) {
        const candidate = new Date(Date.UTC(
          bucket.getUTCFullYear(),
          bucket.getUTCMonth(),
          bucket.getUTCDate(),
          bucket.getUTCHours(),
          minute,
        ))
        if (candidate.getTime() > after.getTime() && matchesOccurrence(candidate, anchor, rrule)) return candidate
      }
    }
    throw new Error('Unsupported automation RRULE for scheduler: no occurrence found in search window')
  }

  const hours = rrule.byhour ?? [roundDownToMinute(anchor).getUTCHours()]
  const minutes = rrule.byminute ?? [roundDownToMinute(anchor).getUTCMinutes()]
  for (let day = startOfUtcDay(start); day.getTime() <= searchEnd.getTime(); day = new Date(day.getTime() + 24 * 60 * 60_000)) {
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = new Date(Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate(),
          hour,
          minute,
        ))
        if (candidate.getTime() > after.getTime() && matchesOccurrence(candidate, anchor, rrule)) return candidate
      }
    }
  }
  throw new Error('Unsupported automation RRULE for scheduler: no occurrence found in search window')
}

function matchesOccurrence(candidate: Date, anchor: Date, rrule: SupportedRrule): boolean {
  if (candidate.getUTCSeconds() !== 0 || candidate.getUTCMilliseconds() !== 0) return false
  if (rrule.byhour && !rrule.byhour.includes(candidate.getUTCHours())) return false
  if (rrule.byminute && !rrule.byminute.includes(candidate.getUTCMinutes())) return false
  if (rrule.byday && !rrule.byday.some((day) => WEEKDAY_INDEX[day] === candidate.getUTCDay())) return false

  const anchorMinute = roundDownToMinute(anchor)
  if (candidate.getTime() < anchorMinute.getTime()) return false
  if (rrule.freq === 'MINUTELY') {
    return wholeMinutesBetween(anchorMinute, candidate) % rrule.interval === 0
  }
  if (!rrule.byminute && candidate.getUTCMinutes() !== anchorMinute.getUTCMinutes()) return false

  if (rrule.freq === 'HOURLY') {
    return wholeHoursBetween(roundDownToHour(anchorMinute), roundDownToHour(candidate)) % rrule.interval === 0
  }
  if (!rrule.byhour && candidate.getUTCHours() !== anchorMinute.getUTCHours()) return false

  if (rrule.freq === 'DAILY') {
    return wholeDaysBetween(startOfUtcDay(anchorMinute), startOfUtcDay(candidate)) % rrule.interval === 0
  }

  if (!rrule.byday && candidate.getUTCDay() !== anchorMinute.getUTCDay()) return false
  return wholeWeeksBetween(startOfUtcWeek(anchorMinute), startOfUtcWeek(candidate)) % rrule.interval === 0
}

function roundDownToMinute(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
  ))
}

function roundDownToHour(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours()))
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function startOfUtcWeek(value: Date): Date {
  const dayStart = startOfUtcDay(value)
  const daysSinceMonday = (dayStart.getUTCDay() + 6) % 7
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000)
}

function wholeMinutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60_000)
}

function wholeHoursBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (60 * 60_000))
}

function wholeDaysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60_000))
}

function wholeWeeksBetween(a: Date, b: Date): number {
  return Math.floor(wholeDaysBetween(a, b) / 7)
}
