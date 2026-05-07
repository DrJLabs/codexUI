import type { AutomationDefinition, AutomationRun, AutomationRunMode } from '../types/automations'
export {
  buildDailyRrule,
  buildHourlyRrule,
  buildHourlyIntervalRrule,
  buildMinuteIntervalRrule,
  buildWeekdaysRrule,
  buildWeekendsRrule,
  buildWeeklyRrule,
  classifyAutomationRrule,
  describeAutomationSchedule,
  type AutomationRruleClassification,
  type AutomationScheduleFrequency,
} from './automationSchedule'

type HealthTone = 'neutral' | 'good' | 'warning' | 'danger'

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
  const projectPath = run.worktreePath ?? run.cwd
  const liveTimestamp = run.state === 'running' || run.state === 'queued' || run.state === 'starting'
    ? run.updatedAtIso ?? run.startedAtIso
    : null
  return {
    id: run.id,
    state: run.state,
    title: run.automationName,
    project: projectPath ? basename(projectPath) : (run.threadId || run.targetThreadId) ? 'Thread' : 'No project',
    age: formatAutomationRelativeTime(run.completedAtIso ?? liveTimestamp ?? run.createdAtIso, now),
  }
}

export function describeRunHealth(
  runs: AutomationRun[],
): { label: string; tone: HealthTone } {
  const latestRun = mostRecentRun(runs)

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

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || normalized || path
}

function mostRecentRun(runs: AutomationRun[]): AutomationRun | null {
  if (runs.length === 0) return null
  return runs.reduce((latest, current) => timestampForRun(current) > timestampForRun(latest) ? current : latest)
}

function timestampForRun(run: AutomationRun): number {
  return Date.parse(run.completedAtIso ?? run.updatedAtIso ?? run.startedAtIso ?? run.createdAtIso) || 0
}
