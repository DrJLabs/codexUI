import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import { createAutomationRunPaths, createAutomationRunStore } from '../runStore'

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

  it('derives write paths from the automation directory instead of persisted run paths', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const runId = 'automation_run_corrupt_paths'
    const outsideRunJsonPath = join(automationDir, 'outside-run.json')
    const outsideEventsPath = join(automationDir, 'outside-events.jsonl')
    const outsideLogPath = join(automationDir, 'outside-run.log')
    const runDir = join(automationDir, 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'run.json'), `${JSON.stringify(automationRunFixture({
      id: runId,
      runJsonPath: outsideRunJsonPath,
      eventsPath: outsideEventsPath,
      logPath: outsideLogPath,
    }), null, 2)}\n`, 'utf8')
    const store = createAutomationRunStore(automationDir)

    const run = await store.readRun(runId)
    const updated = await store.updateRun(runId, {
      inboxTitle: 'Updated',
      runJsonPath: outsideRunJsonPath,
      eventsPath: outsideEventsPath,
      logPath: outsideLogPath,
    })
    await store.appendEvent({ ...updated, eventsPath: outsideEventsPath }, { type: 'test.event' })
    await store.appendLog({ ...updated, logPath: outsideLogPath }, 'test log')
    const canonicalPaths = createAutomationRunPaths(automationDir, runId)

    expect(run).toMatchObject(canonicalPaths)
    expect(updated).toMatchObject({ ...canonicalPaths, inboxTitle: 'Updated' })
    await expect(readFile(canonicalPaths.runJsonPath, 'utf8')).resolves.toContain('"inboxTitle": "Updated"')
    await expect(readFile(canonicalPaths.eventsPath, 'utf8')).resolves.toContain('"type":"test.event"')
    await expect(readFile(canonicalPaths.logPath, 'utf8')).resolves.toContain('test log')
    await expect(readFile(outsideRunJsonPath, 'utf8')).rejects.toThrow()
    await expect(readFile(outsideEventsPath, 'utf8')).rejects.toThrow()
    await expect(readFile(outsideLogPath, 'utf8')).rejects.toThrow()
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
