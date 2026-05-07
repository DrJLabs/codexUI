import { describe, expect, it } from 'vitest'
import type { AutomationDefinition, AutomationRun } from '../types/automations'
import {
  buildDailyRrule,
  buildHourlyRrule,
  buildHourlyIntervalRrule,
  buildMinuteIntervalRrule,
  buildWeekdaysRrule,
  buildWeekendsRrule,
  buildWeeklyRrule,
  classifyAutomationRrule,
  describeAutomationProjectLabel,
  describeAutomationRunListItem,
  describeAutomationRunMode,
  describeAutomationSchedule,
  describeAutomationTarget,
  describeRunHealth,
  formatAutomationRelativeTime,
} from './automationDisplay'

describe('automationDisplay', () => {
  it('describes Desktop interval RRULE schedules', () => {
    expect(describeAutomationSchedule('FREQ=MINUTELY;INTERVAL=15')).toBe('Every 15 minutes')
    expect(describeAutomationSchedule('RRULE:FREQ=MINUTELY;INTERVAL=1')).toBe('Every minute')
    expect(describeAutomationSchedule('FREQ=HOURLY;INTERVAL=1')).toBe('Every hour')
    expect(describeAutomationSchedule('FREQ=HOURLY;INTERVAL=6')).toBe('Every 6 hours')
    expect(describeAutomationSchedule('RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA')).toBe('Hourly')
  })

  it('describes daily RRULE schedules', () => {
    expect(describeAutomationSchedule('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')).toBe('Daily at 9:00 AM')
    expect(describeAutomationSchedule('FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0')).toBe(
      'Daily at 9:00 AM',
    )
  })

  it('describes weekdays and weekends RRULE schedules', () => {
    expect(describeAutomationSchedule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0')).toBe(
      'Weekdays at 9:00 AM',
    )
    expect(describeAutomationSchedule('FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=10;BYMINUTE=30')).toBe(
      'Weekends at 10:30 AM',
    )
  })

  it('describes weekly RRULE schedules', () => {
    expect(describeAutomationSchedule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=30')).toBe(
      'Weekly on Monday at 10:30 AM',
    )
    expect(describeAutomationSchedule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=10;BYMINUTE=30')).toBe(
      'Weekly on Monday at 10:30 AM',
    )
  })

  it('keeps unknown RRULE schedules visible as custom schedules', () => {
    expect(describeAutomationSchedule('FREQ=MONTHLY;BYMONTHDAY=1')).toBe(
      'Custom schedule: FREQ=MONTHLY;BYMONTHDAY=1',
    )
    expect(describeAutomationSchedule('RRULE:FREQ=MONTHLY;BYMONTHDAY=1')).toBe(
      'Custom schedule: RRULE:FREQ=MONTHLY;BYMONTHDAY=1',
    )
  })

  it('keeps modified daily RRULE schedules visible as custom schedules', () => {
    expect(describeAutomationSchedule('FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0')).toBe(
      'Custom schedule: FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0',
    )
    expect(describeAutomationSchedule('FREQ=DAILY;BYDAY=MO;BYHOUR=9;BYMINUTE=0')).toBe(
      'Custom schedule: FREQ=DAILY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    )
  })

  it('keeps list-based daily RRULE schedules visible as custom schedules', () => {
    expect(describeAutomationSchedule('FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0')).toBe(
      'Custom schedule: FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0',
    )
  })

  it('keeps out-of-range RRULE times visible as custom schedules', () => {
    expect(describeAutomationSchedule('FREQ=DAILY;BYHOUR=99;BYMINUTE=0')).toBe(
      'Custom schedule: FREQ=DAILY;BYHOUR=99;BYMINUTE=0',
    )
    expect(describeAutomationSchedule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=99')).toBe(
      'Custom schedule: FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=99',
    )
  })

  it('keeps modified weekly RRULE schedules visible as custom schedules', () => {
    expect(describeAutomationSchedule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=10;BYMINUTE=30')).toBe(
      'Custom schedule: FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=10;BYMINUTE=30',
    )
  })

  it('keeps list-based weekly RRULE schedules visible as custom schedules', () => {
    expect(describeAutomationSchedule('FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=30')).toBe(
      'Custom schedule: FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=30',
    )
    expect(describeAutomationSchedule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=10,14;BYMINUTE=30')).toBe(
      'Custom schedule: FREQ=WEEKLY;BYDAY=MO;BYHOUR=10,14;BYMINUTE=30',
    )
  })

  it('builds daily RRULE schedules from time input', () => {
    expect(buildDailyRrule('09:05')).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=5')
  })

  it('builds Desktop interval and weekday RRULE schedules from controls', () => {
    expect(buildMinuteIntervalRrule(15)).toBe('FREQ=MINUTELY;INTERVAL=15')
    expect(buildHourlyRrule()).toBe('FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA')
    expect(buildHourlyIntervalRrule(6)).toBe('FREQ=HOURLY;INTERVAL=6')
    expect(buildWeekdaysRrule('09:00')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0')
    expect(buildWeekendsRrule('10:30')).toBe('FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=10;BYMINUTE=30')
  })

  it('classifies interval schedules separately from wall-clock schedules', () => {
    expect(classifyAutomationRrule('FREQ=MINUTELY;INTERVAL=15')).toMatchObject({
      frequency: 'minute_interval',
      scheduleKind: 'interval',
      intervalCount: 15,
    })
    expect(classifyAutomationRrule('FREQ=HOURLY;INTERVAL=1')).toMatchObject({
      frequency: 'hour_interval',
      scheduleKind: 'interval',
      intervalCount: 1,
    })
    expect(classifyAutomationRrule('RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA')).toMatchObject({
      frequency: 'hourly',
      scheduleKind: 'wall_clock',
      intervalCount: null,
    })
    expect(classifyAutomationRrule('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')).toMatchObject({
      frequency: 'daily',
      scheduleKind: 'wall_clock',
    })
  })

  it('rejects invalid daily RRULE time input', () => {
    expect(() => buildDailyRrule('')).toThrow('Expected time in HH:MM format from 00:00 through 23:59')
    expect(() => buildDailyRrule('9:05')).toThrow('Expected time in HH:MM format from 00:00 through 23:59')
    expect(() => buildDailyRrule('24:00')).toThrow('Expected time in HH:MM format from 00:00 through 23:59')
    expect(() => buildDailyRrule('23:60')).toThrow('Expected time in HH:MM format from 00:00 through 23:59')
  })

  it('builds weekly RRULE schedules from day and time input', () => {
    expect(buildWeeklyRrule('MO', '10:30')).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=30')
  })

  it('rejects invalid weekly RRULE time input', () => {
    expect(() => buildWeeklyRrule('MO', '')).toThrow('Expected time in HH:MM format from 00:00 through 23:59')
    expect(() => buildWeeklyRrule('MO', '10:3')).toThrow(
      'Expected time in HH:MM format from 00:00 through 23:59',
    )
    expect(() => buildWeeklyRrule('MO', '99:30')).toThrow(
      'Expected time in HH:MM format from 00:00 through 23:59',
    )
  })

  it('describes thread automation targets', () => {
    expect(describeAutomationTarget(automationFixture())).toEqual({
      label: 'Thread automation',
      detail: 'thread_1',
    })
  })

  it('describes local cwd automation targets', () => {
    expect(
      describeAutomationTarget(
        automationFixture({
          targetThreadId: null,
          cwd: '/home/drj/projects/codexUI',
        }),
      ),
    ).toEqual({
      label: 'codexUI',
      detail: '/home/drj/projects/codexUI',
    })
  })

  it('describes Windows-style local cwd automation targets', () => {
    expect(
      describeAutomationTarget(
        automationFixture({
          targetThreadId: null,
          cwd: 'C:\\projects\\codexUI',
        }),
      ),
    ).toEqual({
      label: 'codexUI',
      detail: 'C:\\projects\\codexUI',
    })
  })

  it('describes Desktop projectless automation targets', () => {
    const definition = automationFixture({
      targetThreadId: null,
      cwd: '~',
      cwds: ['~'],
      runMode: 'local',
    })

    expect(describeAutomationTarget(definition)).toEqual({
      label: 'Projectless automation',
      detail: 'Documents/Codex generated folder',
    })
    expect(describeAutomationProjectLabel(definition)).toBe('Projectless')
  })

  it('marks failed latest runs as needing attention', () => {
    expect(describeRunHealth([automationRunFixture({ state: 'failed' })])).toEqual({
      label: 'Needs attention',
      tone: 'danger',
    })
  })

  it('marks automations with no runs as not yet run', () => {
    expect(describeRunHealth([])).toEqual({
      label: 'No runs yet',
      tone: 'neutral',
    })
  })

  it('describes compact run mode labels', () => {
    expect(describeAutomationRunMode('chat')).toBe('Chat')
    expect(describeAutomationRunMode('local')).toBe('Local')
    expect(describeAutomationRunMode('worktree')).toBe('Worktree')
    expect(describeAutomationRunMode(null)).toBe('Chat')
  })

  it('describes compact project labels for automation definitions', () => {
    expect(describeAutomationProjectLabel(automationFixture())).toBe('Thread')
    expect(describeAutomationProjectLabel(automationFixture({
      targetThreadId: null,
      cwd: '/home/drj/projects/apollo',
    }))).toBe('apollo')
    expect(describeAutomationProjectLabel(automationFixture({
      targetThreadId: null,
      cwd: null,
      projectRoot: '/home/drj/projects/codexUI',
    }))).toBe('codexUI')
    expect(describeAutomationProjectLabel(automationFixture({
      targetThreadId: null,
      cwd: null,
      projectRoot: null,
      cwds: [],
    }))).toBe('No project')
  })

  it('formats compact relative automation times', () => {
    const now = new Date('2026-05-02T06:00:00.000Z')
    expect(formatAutomationRelativeTime('2026-05-02T05:31:00.000Z', now)).toBe('29m')
    expect(formatAutomationRelativeTime('2026-05-02T05:00:00.000Z', now)).toBe('1h')
    expect(formatAutomationRelativeTime('2026-04-30T06:00:00.000Z', now)).toBe('2d')
    expect(formatAutomationRelativeTime('2026-05-02T07:00:00.000Z', now)).toBe('0m')
    expect(formatAutomationRelativeTime(null, now)).toBe('n/a')
  })

  it('describes compact run list items', () => {
    const now = new Date('2026-05-02T06:00:00.000Z')
    expect(describeAutomationRunListItem(automationRunFixture({
      automationName: 'hourly fixture',
      cwd: '/home/drj/projects/apollo',
      completedAtIso: '2026-05-02T05:31:00.000Z',
      state: 'completed_no_findings',
    }), now)).toEqual({
      id: 'run_1',
      state: 'completed_no_findings',
      title: 'hourly fixture',
      project: 'apollo',
      age: '29m',
    })
  })

  it('uses active timestamps for in-progress compact run list items', () => {
    const now = new Date('2026-05-02T06:00:00.000Z')
    expect(describeAutomationRunListItem(automationRunFixture({
      state: 'running',
      completedAtIso: null,
      updatedAtIso: '2026-05-02T05:31:00.000Z',
      startedAtIso: '2026-05-02T05:00:00.000Z',
    }), now).age).toBe('29m')
  })

  it('describes compact run projects across worktree, thread, and unscoped runs', () => {
    const now = new Date('2026-05-02T06:00:00.000Z')
    expect(describeAutomationRunListItem(automationRunFixture({
      cwd: '/home/drj/projects/apollo',
      worktreePath: '/tmp/worktrees/apollo-review',
      targetThreadId: null,
      threadId: null,
    }), now).project).toBe('apollo-review')
    expect(describeAutomationRunListItem(automationRunFixture({
      cwd: null,
      worktreePath: null,
      targetThreadId: 'thread_1',
      threadId: null,
    }), now).project).toBe('Thread')
    expect(describeAutomationRunListItem(automationRunFixture({
      cwd: null,
      worktreePath: null,
      targetThreadId: null,
      threadId: null,
    }), now).project).toBe('No project')
  })

  it('uses queued and starting timestamps for compact run list item ages', () => {
    const now = new Date('2026-05-02T06:00:00.000Z')
    expect(describeAutomationRunListItem(automationRunFixture({
      state: 'queued',
      completedAtIso: null,
      updatedAtIso: '2026-05-02T05:45:00.000Z',
      startedAtIso: null,
    }), now).age).toBe('15m')
    expect(describeAutomationRunListItem(automationRunFixture({
      state: 'starting',
      completedAtIso: null,
      updatedAtIso: '2026-05-02T05:50:00.000Z',
      startedAtIso: '2026-05-02T05:48:00.000Z',
    }), now).age).toBe('10m')
  })
})

function automationFixture(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: 'auto_1',
    kind: 'heartbeat',
    source: 'native',
    nativeId: 'auto_1',
    name: 'Daily check',
    description: null,
    prompt: 'Check this thread',
    status: 'active',
    legacyStatus: 'ACTIVE',
    schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    targetThreadId: 'thread_1',
    projectRoot: null,
    cwd: null,
    cwds: [],
    runMode: null,
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    localEnvironmentConfigPath: null,
    autoArchiveNoFindings: false,
    notifyOnFindings: false,
    kanbanProjection: { mode: 'off' },
    notes: '',
    storage: {
      nativeDirName: 'auto_1',
      nativePath: '/tmp/automations/auto_1/automation.toml',
      sidecarPath: '/tmp/automations/auto_1/codexui.local.json',
      memoryPath: '/tmp/automations/auto_1/memory.md',
    },
    createdAtIso: '2026-04-30T00:00:00.000Z',
    updatedAtIso: '2026-04-30T00:00:00.000Z',
    lastRunAtIso: null,
    nextRunAtIso: null,
    version: 1,
    ...overrides,
  }
}

function automationRunFixture(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run_1',
    automationId: 'auto_1',
    automationName: 'Daily check',
    trigger: 'manual',
    runMode: 'chat',
    state: 'completed_no_findings',
    promptSnapshot: 'Check this thread',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    dueAtIso: null,
    nextDueAtIso: null,
    runProfileId: 'workspace-coding',
    runProfileSnapshot: {
      id: 'workspace-coding',
      name: 'Workspace coding',
      description: '',
      model: '',
      reasoningEffort: 'medium',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      networkAccess: false,
      writableRoots: [],
      createdAtIso: '2026-04-30T00:00:00.000Z',
      updatedAtIso: '2026-04-30T00:00:00.000Z',
    },
    targetThreadId: 'thread_1',
    cwd: null,
    worktreePath: null,
    branchName: null,
    threadId: 'thread_1',
    turnId: null,
    resultSummary: null,
    errorMessage: null,
    findings: false,
    inboxTitle: 'Daily check',
    inboxSummary: '',
    readAtIso: null,
    archivedAtIso: null,
    kanbanTaskId: null,
    reviewPacketId: null,
    proposalIds: [],
    runJsonPath: '/tmp/automations/auto_1/runs/run_1/run.json',
    eventsPath: '/tmp/automations/auto_1/runs/run_1/events.jsonl',
    logPath: '/tmp/automations/auto_1/runs/run_1/output.log',
    createdAtIso: '2026-04-30T01:00:00.000Z',
    startedAtIso: '2026-04-30T01:00:00.000Z',
    completedAtIso: '2026-04-30T01:01:00.000Z',
    updatedAtIso: '2026-04-30T01:01:00.000Z',
    ...overrides,
  }
}
