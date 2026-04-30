import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAutomationSchedulerStore } from '../schedulerStore'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempAutomationDir() {
  const dir = await mkdtemp(join(tmpdir(), 'codexui-scheduler-store-'))
  tempDirs.push(dir)
  return dir
}

describe('createAutomationSchedulerStore', () => {
  it('returns deterministic missing state defaults without writing scheduler.json', async () => {
    const automationDir = await createTempAutomationDir()
    const store = createAutomationSchedulerStore(automationDir)

    const state = await store.readOrDefault({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
    })

    expect(state).toEqual({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: '',
      nextDueAtIso: null,
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: null,
    })
    await expect(readFile(join(automationDir, 'scheduler.json'), 'utf8')).rejects.toThrow()
  })

  it('writes and reads scheduler state from scheduler.json', async () => {
    const automationDir = await createTempAutomationDir()
    const store = createAutomationSchedulerStore(automationDir)

    const written = await store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })

    expect(await store.readState()).toEqual(written)
    await expect(readFile(join(automationDir, 'scheduler.json'), 'utf8')).resolves.toContain('"scheduleHash": "hash-a"')
  })

  it('updates existing scheduler state while preserving unchanged fields', async () => {
    const automationDir = await createTempAutomationDir()
    const store = createAutomationSchedulerStore(automationDir)
    await store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      lastScheduledRunId: 'run-1',
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })

    const updated = await store.updateState({
      scheduleHash: 'hash-b',
      nextDueAtIso: null,
      unsupportedReason: 'Scheduler execution for FREQ=MONTHLY is not implemented',
      updatedAtIso: '2026-04-30T10:00:00.000Z',
    })

    expect(updated).toMatchObject({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-b',
      nextDueAtIso: null,
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      lastScheduledRunId: 'run-1',
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      unsupportedReason: 'Scheduler execution for FREQ=MONTHLY is not implemented',
      updatedAtIso: '2026-04-30T10:00:00.000Z',
    })
    expect(await store.readState()).toEqual(updated)
  })

  it('rejects scheduler state with invalid ISO timestamp fields', async () => {
    const automationDir = await createTempAutomationDir()
    const schedulerPath = join(automationDir, 'scheduler.json')
    await mkdir(automationDir, { recursive: true })
    await writeFile(schedulerPath, `${JSON.stringify({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: 'not-an-iso',
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })}\n`, 'utf8')

    await expect(createAutomationSchedulerStore(automationDir).readState()).rejects.toThrow(/nextDueAtIso/)
  })
})
