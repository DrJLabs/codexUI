import type { AutomationDefinition, AutomationRun, AutomationRunMode } from '../types/automations'

type HealthTone = 'neutral' | 'good' | 'warning' | 'danger'

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

const TIME_INPUT_ERROR = 'Expected time in HH:MM format from 00:00 through 23:59'
const SIMPLE_DAILY_KEYS = ['BYHOUR', 'BYMINUTE', 'FREQ']
const SIMPLE_WEEKLY_KEYS = ['BYDAY', 'BYHOUR', 'BYMINUTE', 'FREQ']

export function describeAutomationSchedule(rrule: string): string {
  const parts = parseRrule(rrule)
  const hour = parseNumberPart(parts.BYHOUR)
  const minute = parseNumberPart(parts.BYMINUTE)

  if (hasOnlyKeys(parts, SIMPLE_DAILY_KEYS) && parts.FREQ === 'DAILY' && hour !== null && minute !== null) {
    return `Daily at ${formatTime(hour, minute)}`
  }

  if (
    hasOnlyKeys(parts, SIMPLE_WEEKLY_KEYS) &&
    parts.FREQ === 'WEEKLY' &&
    parts.BYDAY &&
    hour !== null &&
    minute !== null
  ) {
    const day = WEEKDAY_LABELS[parts.BYDAY]
    if (day) return `Weekly on ${day} at ${formatTime(hour, minute)}`
  }

  return `Custom schedule: ${rrule}`
}

export function buildDailyRrule(time: string): string {
  const { hour, minute } = parseTimeInput(time)
  return `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`
}

export function buildWeeklyRrule(day: string, time: string): string {
  const { hour, minute } = parseTimeInput(time)
  return `FREQ=WEEKLY;BYDAY=${normalizeWeekday(day)};BYHOUR=${hour};BYMINUTE=${minute}`
}

export function describeAutomationTarget(definition: AutomationDefinition): { label: string; detail: string } {
  if (definition.targetThreadId) {
    return {
      label: 'Thread automation',
      detail: definition.targetThreadId,
    }
  }

  const path = definition.cwd ?? definition.projectRoot ?? definition.cwds[0] ?? null
  if (path) {
    return {
      label: basename(path),
      detail: path,
    }
  }

  return {
    label: 'Local automation',
    detail: 'No project folder configured',
  }
}

export function describeAutomationRunMode(mode: AutomationRunMode | null | undefined): string {
  if (mode === 'local') return 'Local'
  if (mode === 'worktree') return 'Worktree'
  return 'Chat'
}

export function describeAutomationProjectLabel(definition: AutomationDefinition): string {
  const path = definition.cwd ?? definition.projectRoot ?? definition.cwds[0] ?? null
  if (path) return basename(path)
  if (definition.targetThreadId) return 'Thread'
  return 'No project'
}

export function formatAutomationRelativeTime(value: string | null | undefined, now = new Date()): string {
  if (!value) return 'n/a'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'n/a'
  const elapsedMs = Math.max(0, now.getTime() - timestamp)
  const elapsedMinutes = Math.floor(elapsedMs / 60_000)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  return `${Math.floor(elapsedHours / 24)}d`
}

export function describeAutomationRunListItem(run: AutomationRun, now = new Date()): {
  id: string
  state: AutomationRun['state']
  title: string
  project: string
  age: string
} {
  return {
    id: run.id,
    state: run.state,
    title: run.automationName,
    project: basename(run.worktreePath ?? run.cwd ?? '') || 'Thread',
    age: formatAutomationRelativeTime(run.completedAtIso ?? run.startedAtIso ?? run.updatedAtIso ?? run.createdAtIso, now),
  }
}

export function describeRunHealth(
  definition: AutomationDefinition,
  runs: AutomationRun[],
): { label: string; tone: HealthTone } {
  const latestRun = mostRecentRun(runs.length > 0 ? runs : definition.recentRuns ?? [])

  if (!latestRun) {
    return { label: 'No runs yet', tone: 'neutral' }
  }

  if (latestRun.state === 'failed') {
    return { label: 'Needs attention', tone: 'danger' }
  }

  if (latestRun.state === 'completed_with_findings') {
    return { label: 'Completed with findings', tone: 'warning' }
  }

  if (latestRun.state === 'completed_no_findings') {
    return { label: 'Healthy', tone: 'good' }
  }

  return { label: 'Run in progress', tone: 'neutral' }
}

function parseRrule(rrule: string): Record<string, string> {
  return rrule.split(';').reduce<Record<string, string>>((parts, rawPart) => {
    const [rawKey, rawValue] = rawPart.split('=')
    const key = rawKey?.trim().toUpperCase()
    const value = rawValue?.trim()
    if (key && value) parts[key] = value.toUpperCase()
    return parts
  }, {})
}

function parseNumberPart(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseTimeInput(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) throw new Error(TIME_INPUT_ERROR)

  const hour = Number.parseInt(match[1], 10)
  const minute = Number.parseInt(match[2], 10)
  if (hour > 23 || minute > 59) throw new Error(TIME_INPUT_ERROR)

  return { hour, minute }
}

function normalizeWeekday(day: string): string {
  const trimmed = day.trim()
  const upper = trimmed.toUpperCase()
  if (WEEKDAY_LABELS[upper]) return upper
  return WEEKDAY_CODES[trimmed.toLowerCase()] ?? upper
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || normalized || path
}

function mostRecentRun(runs: AutomationRun[]): AutomationRun | null {
  if (runs.length === 0) return null
  return [...runs].sort((a, b) => timestampForRun(b) - timestampForRun(a))[0] ?? null
}

function timestampForRun(run: AutomationRun): number {
  return Date.parse(run.completedAtIso ?? run.startedAtIso ?? run.updatedAtIso ?? run.createdAtIso) || 0
}

function hasOnlyKeys(parts: Record<string, string>, expectedKeys: string[]): boolean {
  const keys = Object.keys(parts).sort()
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
}
