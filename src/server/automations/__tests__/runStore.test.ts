import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import { createAutomationRunStore } from '../runStore'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true })
  }))
})

describe('createAutomationRunStore', () => {
  it('normalizes legacy run records without branchName', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const runId = 'automation_run_legacy'
    const runDir = join(automationDir, 'runs', runId)
    await mkdir(runDir, { recursive: true })
    const legacyRun = automationRunFixture({ id: runId })
    delete (legacyRun as Partial<AutomationRun>).branchName
    delete (legacyRun as Partial<AutomationRun>).findings
    delete (legacyRun as Partial<AutomationRun>).inboxTitle
    delete (legacyRun as Partial<AutomationRun>).inboxSummary
    delete (legacyRun as Partial<AutomationRun>).readAtIso
    delete (legacyRun as Partial<AutomationRun>).archivedAtIso
    delete (legacyRun as Partial<AutomationRun>).kanbanTaskId
    delete (legacyRun as Partial<AutomationRun>).reviewPacketId
    delete (legacyRun as Partial<AutomationRun>).proposalIds
    await writeFile(join(runDir, 'run.json'), `${JSON.stringify(legacyRun, null, 2)}\n`, 'utf8')

    const runs = await createAutomationRunStore(automationDir).listRuns()

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      id: runId,
      dueAtIso: null,
      nextDueAtIso: null,
      branchName: null,
      findings: null,
      inboxTitle: '',
      inboxSummary: '',
      readAtIso: null,
      archivedAtIso: null,
      kanbanTaskId: null,
      reviewPacketId: null,
      proposalIds: [],
    })
  })
})

function automationRunFixture(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'automation_run_1',
    automationId: 'auto_1',
    automationName: 'Daily check',
    trigger: 'manual',
    runMode: 'chat',
    state: 'running',
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
    turnId: 'turn_1',
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
    runJsonPath: '/tmp/run.json',
    eventsPath: '/tmp/events.jsonl',
    logPath: '/tmp/run.log',
    createdAtIso: '2026-04-30T00:00:00.000Z',
    startedAtIso: '2026-04-30T00:00:00.000Z',
    completedAtIso: null,
    updatedAtIso: '2026-04-30T00:00:00.000Z',
    ...overrides,
  }
}
