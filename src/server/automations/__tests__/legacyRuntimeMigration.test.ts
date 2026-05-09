import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import { closeDesktopAutomationSqlite, openDesktopAutomationSqlite, readDesktopAutomationRunRow, readDesktopAutomationRuntimeRow } from '../desktopSqlite'
import { migrateLegacyAutomationRuntimeToDesktopSqlite } from '../legacyRuntimeMigration'
import { writeNativeAutomation } from '../nativeStore'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('migrateLegacyAutomationRuntimeToDesktopSqlite', () => {
  it('copies legacy scheduler timing and run rows into Desktop SQLite once', async () => {
    const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-legacy-runtime-migration-'))
    tempDirs.push(codexHomeDir)
    const record = await writeNativeAutomation({
      id: 'daily-check',
      kind: 'cron',
      threadId: null,
      name: 'Daily Check',
      prompt: 'Check the repo',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30',
      status: 'ACTIVE',
      cwd: '/repo',
      runMode: 'local',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    }, { codexHomeDir })
    const automationDir = join(codexHomeDir, 'automations', record.id)
    await writeFile(join(automationDir, 'scheduler.json'), `${JSON.stringify({
      automationId: record.id,
      sourceDirName: record.id,
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    }, null, 2)}\n`, 'utf8')
    const runDir = join(automationDir, 'runs', 'automation_run_legacy')
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'run.json'), `${JSON.stringify(automationRunFixture({
      id: 'automation_run_legacy',
      automationId: record.id,
      automationName: 'Daily Check',
      threadId: 'thread-legacy',
      state: 'completed_no_findings',
      readAtIso: '2026-04-30T10:05:00.000Z',
      inboxTitle: 'Done',
      inboxSummary: 'No findings',
    }), null, 2)}\n`, 'utf8')

    const firstResult = await migrateLegacyAutomationRuntimeToDesktopSqlite({ codexHomeDir })
    const secondResult = await migrateLegacyAutomationRuntimeToDesktopSqlite({ codexHomeDir })

    expect(firstResult).toMatchObject({ skipped: false, migratedSchedulerStates: 1, migratedRuns: 1 })
    expect(secondResult).toMatchObject({ skipped: true, migratedSchedulerStates: 0, migratedRuns: 0 })
    await expect(readFile(firstResult.markerPath, 'utf8')).resolves.toContain('"migratedRuns": 1')
    const handle = openDesktopAutomationSqlite({ codexHomeDir })
    try {
      expect(readDesktopAutomationRuntimeRow(handle, record.id)).toMatchObject({
        id: record.id,
        name: 'Daily Check',
        nextRunAt: Date.parse('2026-04-30T09:30:00.000Z'),
        lastRunAt: Date.parse('2026-04-29T09:30:00.000Z'),
        model: 'gpt-5.5',
        reasoningEffort: 'low',
      })
      expect(readDesktopAutomationRunRow(handle, 'thread-legacy')).toMatchObject({
        threadId: 'thread-legacy',
        automationId: record.id,
        status: 'ACCEPTED',
        readAt: Date.parse('2026-04-30T10:05:00.000Z'),
        inboxTitle: 'Done',
        inboxSummary: 'No findings',
      })
    } finally {
      closeDesktopAutomationSqlite(handle)
    }
  })
})

function automationRunFixture(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'automation_run_1',
    automationId: 'daily-check',
    automationName: 'Daily Check',
    trigger: 'schedule',
    runMode: 'local',
    state: 'running',
    promptSnapshot: 'Check the repo',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30' },
    dueAtIso: '2026-04-30T09:30:00.000Z',
    nextDueAtIso: null,
    runProfileId: 'workspace-coding',
    runProfileSnapshot: {
      id: 'workspace-coding',
      name: 'Workspace coding',
      description: 'Workspace coding',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      networkAccess: false,
      writableRoots: [],
      model: '',
      reasoningEffort: '',
      createdAtIso: '2026-04-30T10:00:00.000Z',
      updatedAtIso: '2026-04-30T10:00:00.000Z',
    },
    targetThreadId: null,
    cwd: '/repo',
    worktreePath: null,
    branchName: null,
    threadId: null,
    turnId: null,
    resultSummary: null,
    errorMessage: null,
    findings: null,
    inboxTitle: '',
    inboxSummary: '',
    readAtIso: null,
    archivedAtIso: null,
    kanbanTaskId: null,
    reviewPacketId: null,
    proposalIds: [],
    runJsonPath: '',
    eventsPath: '',
    logPath: '',
    createdAtIso: '2026-04-30T10:00:00.000Z',
    startedAtIso: '2026-04-30T10:01:00.000Z',
    completedAtIso: null,
    updatedAtIso: '2026-04-30T10:05:00.000Z',
    ...overrides,
  }
}
