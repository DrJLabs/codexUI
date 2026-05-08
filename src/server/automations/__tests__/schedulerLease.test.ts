import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAutomationSchedulerLeaseStore } from '../schedulerLease'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true })
  }))
})

async function tempAutomationDir() {
  const dir = await mkdtemp(join(tmpdir(), 'codexui-scheduler-lease-'))
  tempDirs.push(dir)
  return join(dir, 'automations', 'daily-check-dir')
}

describe('createAutomationSchedulerLeaseStore', () => {
  it('acquires a lease with process metadata and releases only its own lock', async () => {
    const automationDir = await tempAutomationDir()
    const store = createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-a',
      pid: 111,
      hostname: 'host-a',
      ttlMs: 60_000,
    })

    const handle = await store.acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:59:00.000Z',
    })

    expect(handle?.lease).toMatchObject({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      owner: 'codexui',
      ownerId: 'owner-a',
      pid: 111,
      hostname: 'host-a',
      acquiredAtIso: '2026-04-30T08:59:00.000Z',
      expiresAtIso: '2026-04-30T09:00:00.000Z',
      dueAtIso: '2026-04-30T09:00:00.000Z',
    })
    await expect(readFile(store.path, 'utf8')).resolves.toContain('"ownerId": "owner-a"')

    await handle?.release()

    await expect(readFile(store.path, 'utf8')).resolves.toContain('"releasedAtIso":')
  })

  it('blocks a second owner while the current lease is active', async () => {
    const automationDir = await tempAutomationDir()
    await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-a',
      ttlMs: 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:59:00.000Z',
    })

    const second = await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-b',
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:59:30.000Z',
    })

    expect(second).toBeNull()
  })

  it('replaces a stale lease', async () => {
    const automationDir = await tempAutomationDir()
    await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-a',
      ttlMs: 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:00:00.000Z',
    })

    const replacement = await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-b',
      ttlMs: 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:59:00.000Z',
    })

    expect(replacement?.lease.ownerId).toBe('owner-b')
    expect(replacement?.lease.generation).toBe(1)
    await expect(readFile(join(automationDir, 'scheduler-lock.1.json'), 'utf8')).resolves.toContain('"ownerId": "owner-b"')
  })

  it('uses a new generation after a released lease', async () => {
    const automationDir = await tempAutomationDir()
    const first = await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-a',
      ttlMs: 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:59:00.000Z',
    })
    await first?.release()

    const second = await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-b',
      ttlMs: 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:59:30.000Z',
    })

    expect(second?.lease).toMatchObject({
      ownerId: 'owner-b',
      generation: 1,
    })
    await expect(readFile(join(automationDir, 'scheduler-lock.json'), 'utf8')).resolves.toContain('"releasedAtIso":')
    await expect(readFile(join(automationDir, 'scheduler-lock.1.json'), 'utf8')).resolves.toContain('"releasedAtIso": null')
  })

  it('keeps only recent lock generations when acquiring new leases', async () => {
    const automationDir = await tempAutomationDir()
    const store = createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'owner-a',
      ttlMs: 60_000,
    })

    for (let index = 0; index < 90; index += 1) {
      const handle = await store.acquire({
        automationId: 'daily-check',
        sourceDirName: 'daily-check-dir',
        dueAtIso: '2026-04-30T09:00:00.000Z',
        nowIso: new Date(Date.parse('2026-04-30T08:00:00.000Z') + index * 1000).toISOString(),
      })
      expect(handle?.lease.generation).toBe(index)
      await handle?.release()
    }

    const lockFiles = (await readdir(automationDir)).filter((name) => /^scheduler-lock(?:\.\d+)?\.json$/.test(name))
    expect(lockFiles.length).toBeLessThanOrEqual(81)
    expect(lockFiles.length).toBeLessThan(90)
    expect(lockFiles).not.toContain('scheduler-lock.json')

    const next = await store.acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T09:30:00.000Z',
    })
    expect(next?.lease.generation).toBe(90)
  })
})
