import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
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

  it('limits listed runs after sorting newest first', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const store = createAutomationRunStore(automationDir)
    await store.createRun(automationRunFixture({ id: 'automation_run_1000_old', createdAtIso: '2026-04-30T08:00:00.000Z' }))
    await store.createRun(automationRunFixture({ id: 'automation_run_2000_new', createdAtIso: '2026-04-30T10:00:00.000Z' }))
    await mkdir(join(automationDir, 'runs', 'automation_run_3000_broken'), { recursive: true })
    await writeFile(join(automationDir, 'runs', 'automation_run_3000_broken', 'run.json'), '{broken', 'utf8')

    const runs = await store.listRuns({ limit: 1 })

    expect(runs.map((run) => run.id)).toEqual(['automation_run_2000_new'])
  })

  it('surfaces non-missing run directory read failures instead of reporting empty history', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    await writeFile(join(automationDir, 'runs'), 'not a directory', 'utf8')

    await expect(createAutomationRunStore(automationDir).listRuns()).rejects.toThrow()
  })

  it('surfaces non-missing run file read failures instead of skipping the run', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const runId = 'automation_run_unreadable'
    await mkdir(join(automationDir, 'runs', runId, 'run.json'), { recursive: true })

    await expect(createAutomationRunStore(automationDir).listRuns()).rejects.toThrow()
  })

  it('checks whether a run exists without listing all runs', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const store = createAutomationRunStore(automationDir)
    await store.createRun(automationRunFixture({ id: 'automation_run_exists' }))

    await expect(store.hasRun('automation_run_exists')).resolves.toBe(true)
    await expect(store.hasRun('automation_run_missing')).resolves.toBe(false)
  })

  it('surfaces non-missing run file read failures while checking existence', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const runId = 'automation_run_unreadable'
    await mkdir(join(automationDir, 'runs', runId, 'run.json'), { recursive: true })

    await expect(createAutomationRunStore(automationDir).hasRun(runId)).rejects.toThrow()
  })

  it('normalizes malformed persisted thread and turn identifiers to null', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const runId = 'automation_run_malformed_ids'
    const runDir = join(automationDir, 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'run.json'), `${JSON.stringify({
      ...automationRunFixture({ id: runId }),
      threadId: { nested: 'thread_1' },
      turnId: 123,
    }, null, 2)}\n`, 'utf8')

    const run = await createAutomationRunStore(automationDir).readRun(runId)

    expect(run.threadId).toBeNull()
    expect(run.turnId).toBeNull()
  })

  it('lists active runs even when they are outside the recent-run window', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const store = createAutomationRunStore(automationDir)
    await store.createRun(automationRunFixture({
      id: 'automation_run_1000_active',
      state: 'running',
      createdAtIso: '2026-04-30T08:00:00.000Z',
    }))
    for (let index = 0; index < 25; index += 1) {
      await store.createRun(automationRunFixture({
        id: `automation_run_${String(2000 + index).padStart(4, '0')}_completed`,
        state: 'completed_no_findings',
        createdAtIso: `2026-04-30T09:${String(index).padStart(2, '0')}:00.000Z`,
      }))
    }

    const recentRuns = await store.listRuns({ limit: 5 })
    const activeRuns = await store.listActiveRuns()

    expect(recentRuns.map((run) => run.id)).not.toContain('automation_run_1000_active')
    expect(activeRuns.map((run) => run.id)).toEqual(['automation_run_1000_active'])
  })

  it('trusts an empty active-run index instead of scanning run directories', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const runId = 'automation_run_unindexed_active'
    const runDir = join(automationDir, 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'run.json'), `${JSON.stringify(automationRunFixture({ id: runId, state: 'running' }), null, 2)}\n`, 'utf8')
    await writeFile(join(automationDir, '.active-runs.json'), '[]\n', 'utf8')

    const activeRuns = await createAutomationRunStore(automationDir).listActiveRuns()

    expect(activeRuns).toEqual([])
    await expect(readFile(join(automationDir, '.active-runs.json'), 'utf8')).resolves.toBe('[]\n')
  })

  it('preserves all active run ids when concurrent writes update the active index', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const store = createAutomationRunStore(automationDir)
    const runIds = Array.from({ length: 12 }, (_, index) => `automation_run_concurrent_${index}`)

    await Promise.all(runIds.map(async (runId, index) => {
      await store.createRun(automationRunFixture({
        id: runId,
        state: 'running',
        createdAtIso: `2026-04-30T10:${String(index).padStart(2, '0')}:00.000Z`,
      }))
    }))

    const activeRuns = await store.listActiveRuns()

    expect(activeRuns.map((run) => run.id).sort()).toEqual(runIds.sort())
  })

  it('reclaims a stale active-run index lock owned by a dead process', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const lockDir = join(automationDir, '.active-runs.json.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'owner.json'), `${JSON.stringify({
      pid: 99999999,
      hostname: hostname(),
      startedAtMs: Date.now() - 60_000,
    })}\n`, 'utf8')
    const store = createAutomationRunStore(automationDir)

    const run = await store.createRun(automationRunFixture({ id: 'automation_run_after_stale_lock', state: 'running' }))

    expect(run.id).toBe('automation_run_after_stale_lock')
    await expect(readFile(join(automationDir, '.active-runs.json'), 'utf8')).resolves.toContain('automation_run_after_stale_lock')
  })

  it('uses lock age instead of process liveness for active-run locks from other hosts', async () => {
    const automationDir = await mkdtemp(join(tmpdir(), 'codexui-automation-run-store-'))
    tempDirs.push(automationDir)
    const lockDir = join(automationDir, '.active-runs.json.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'owner.json'), `${JSON.stringify({
      pid: 99999999,
      hostname: 'other-host',
      startedAtMs: Date.now() - 60_000,
    })}\n`, 'utf8')
    const oldDate = new Date(Date.now() - 60_000)
    await utimes(lockDir, oldDate, oldDate)
    const store = createAutomationRunStore(automationDir)

    const run = await store.createRun(automationRunFixture({ id: 'automation_run_after_remote_lock', state: 'running' }))

    expect(run.id).toBe('automation_run_after_remote_lock')
    await expect(readFile(join(automationDir, '.active-runs.json'), 'utf8')).resolves.toContain('automation_run_after_remote_lock')
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
