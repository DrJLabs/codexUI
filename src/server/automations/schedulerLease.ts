import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

const DEFAULT_LEASE_TTL_MS = 10 * 60_000
const DEFAULT_OWNER_ID = `codexui:${hostname()}:${process.pid}:${randomUUID()}`
const BASE_LOCK_FILENAME = 'scheduler-lock.json'
const LOCK_FILENAME_PATTERN = /^scheduler-lock(?:\.(\d+))?\.json$/
const MAX_LOCK_SLOTS_TO_READ = 64

export type AutomationSchedulerLease = {
  automationId: string
  sourceDirName: string
  owner: string
  ownerId: string
  leaseId: string
  generation: number
  pid: number | null
  hostname: string | null
  acquiredAtIso: string
  expiresAtIso: string
  dueAtIso: string
  releasedAtIso: string | null
}

export type AutomationSchedulerLeaseHandle = {
  lease: AutomationSchedulerLease
  release: () => Promise<void>
}

type LockSlot = {
  generation: number
  path: string
  lease: AutomationSchedulerLease | null
}

export function createAutomationSchedulerLeaseStore(
  automationDirPath: string,
  options: {
    owner?: string
    ownerId?: string
    pid?: number | null
    hostname?: string | null
    ttlMs?: number
  } = {},
) {
  const baseLockPath = join(automationDirPath, BASE_LOCK_FILENAME)
  const ownerId = options.ownerId ?? DEFAULT_OWNER_ID
  const owner = options.owner ?? 'codexui'
  const configuredTtlMs = options.ttlMs
  const ttlMs = Number.isFinite(configuredTtlMs) && configuredTtlMs && configuredTtlMs > 0
    ? configuredTtlMs
    : DEFAULT_LEASE_TTL_MS

  return {
    path: baseLockPath,

    async readLease(): Promise<AutomationSchedulerLease | null> {
      const nowMs = Date.now()
      const slots = await listLockSlots(automationDirPath)
      const active = slots.find((slot) => slot.lease && isActiveLease(slot.lease, nowMs))
      if (active?.lease) return active.lease
      return [...slots].reverse().find((slot) => slot.lease)?.lease ?? null
    },

    async acquire(input: {
      automationId: string
      sourceDirName: string
      dueAtIso: string
      nowIso: string
    }): Promise<AutomationSchedulerLeaseHandle | null> {
      const nowMs = Date.parse(input.nowIso)
      if (!Number.isFinite(nowMs)) throw new Error('Invalid scheduler lease nowIso')
      await mkdir(automationDirPath, { recursive: true })

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const slots = await listLockSlots(automationDirPath)
        if (slots.some((slot) => slot.lease && isActiveLease(slot.lease, nowMs))) return null
        const latestGeneration = slots.reduce((max, slot) => Math.max(max, slot.generation), -1)
        const generation = latestGeneration + 1
        const lockPath = lockPathForGeneration(automationDirPath, generation)
        const lease: AutomationSchedulerLease = {
          automationId: input.automationId,
          sourceDirName: input.sourceDirName,
          owner,
          ownerId,
          leaseId: randomUUID(),
          generation,
          pid: options.pid === undefined ? process.pid : options.pid,
          hostname: options.hostname === undefined ? hostname() : options.hostname,
          acquiredAtIso: input.nowIso,
          expiresAtIso: new Date(nowMs + ttlMs).toISOString(),
          dueAtIso: input.dueAtIso,
          releasedAtIso: null,
        }
        const tempPath = `${lockPath}.${ownerId.replace(/[^A-Za-z0-9_.-]/g, '_')}.${lease.leaseId}.tmp`
        const serializedLease = `${JSON.stringify(lease, null, 2)}\n`
        const acquired = await createLeaseFile(tempPath, lockPath, serializedLease)
        if (acquired) {
          return {
            lease,
            release: async () => {
              await releaseLease(lockPath, lease)
            },
          }
        }
      }

      return null
    },
  }
}

async function createLeaseFile(tempPath: string, lockPath: string, content: string): Promise<boolean> {
  await writeFile(tempPath, content, 'utf8')
  try {
    await link(tempPath, lockPath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') return false
    if (!isHardLinkUnsupportedError(error)) throw error
    return await createLeaseFileWithExclusiveOpen(lockPath, content)
  } finally {
    await rm(tempPath, { force: true })
  }
}

async function createLeaseFileWithExclusiveOpen(lockPath: string, content: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(lockPath, 'wx')
    await handle.writeFile(content, 'utf8')
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') return false
    if (handle) await rm(lockPath, { force: true }).catch(() => {})
    throw error
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function releaseLease(lockPath: string, lease: AutomationSchedulerLease): Promise<void> {
  let current: AutomationSchedulerLease
  try {
    current = parseLease(await readFile(lockPath, 'utf8'))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
  if (
    current.automationId !== lease.automationId ||
    current.ownerId !== lease.ownerId ||
    current.leaseId !== lease.leaseId ||
    current.generation !== lease.generation
  ) {
    return
  }
  const released: AutomationSchedulerLease = {
    ...current,
    releasedAtIso: new Date().toISOString(),
  }
  const tempPath = `${lockPath}.${lease.leaseId}.release.tmp`
  await writeFile(tempPath, `${JSON.stringify(released, null, 2)}\n`, 'utf8')
  await rename(tempPath, lockPath)
}

async function listLockSlots(automationDirPath: string): Promise<LockSlot[]> {
  let names: string[]
  try {
    names = await readdir(automationDirPath)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  const lockFiles = names.flatMap((name): Array<{ generation: number; path: string }> => {
    const generation = generationFromFilename(name)
    return generation === null ? [] : [{ generation, path: join(automationDirPath, name) }]
  })
  lockFiles.sort((a, b) => a.generation - b.generation)
  const staleFiles = lockFiles.slice(0, Math.max(0, lockFiles.length - MAX_LOCK_SLOTS_TO_READ))
  await Promise.all(staleFiles.map((slot) => rm(slot.path, { force: true }).catch(() => {})))
  const slots = await Promise.all(lockFiles.slice(-MAX_LOCK_SLOTS_TO_READ).map((slot) => readLockSlot(slot.path, slot.generation)))
  slots.sort((a, b) => a.generation - b.generation)
  return slots
}

async function readLockSlot(path: string, generation: number): Promise<LockSlot> {
  try {
    return {
      generation,
      path,
      lease: parseLease(await readFile(path, 'utf8')),
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { generation, path, lease: null }
    }
    if (error instanceof SyntaxError) {
      return { generation, path, lease: null }
    }
    throw error
  }
}

function generationFromFilename(name: string): number | null {
  const match = LOCK_FILENAME_PATTERN.exec(name)
  if (!match) return null
  if (!match[1]) return 0
  const generation = Number(match[1])
  return Number.isSafeInteger(generation) && generation > 0 ? generation : null
}

function lockPathForGeneration(automationDirPath: string, generation: number): string {
  return join(automationDirPath, generation === 0 ? BASE_LOCK_FILENAME : `scheduler-lock.${generation}.json`)
}

function isActiveLease(lease: AutomationSchedulerLease, nowMs: number): boolean {
  return !lease.releasedAtIso && Date.parse(lease.expiresAtIso) > nowMs
}

function parseLease(raw: string): AutomationSchedulerLease {
  const parsed = JSON.parse(raw) as Partial<AutomationSchedulerLease>
  const generation = typeof parsed.generation === 'number' && Number.isSafeInteger(parsed.generation) && parsed.generation >= 0
    ? parsed.generation
    : 0
  return {
    automationId: readString(parsed.automationId, 'automationId'),
    sourceDirName: readString(parsed.sourceDirName, 'sourceDirName'),
    owner: readString(parsed.owner, 'owner'),
    ownerId: readString(parsed.ownerId, 'ownerId'),
    leaseId: typeof parsed.leaseId === 'string' && parsed.leaseId ? parsed.leaseId : `${parsed.ownerId ?? 'unknown'}:${generation}`,
    generation,
    pid: typeof parsed.pid === 'number' && Number.isFinite(parsed.pid) ? parsed.pid : null,
    hostname: typeof parsed.hostname === 'string' ? parsed.hostname : null,
    acquiredAtIso: readIso(parsed.acquiredAtIso, 'acquiredAtIso'),
    expiresAtIso: readIso(parsed.expiresAtIso, 'expiresAtIso'),
    dueAtIso: readIso(parsed.dueAtIso, 'dueAtIso'),
    releasedAtIso: readNullableIso(parsed.releasedAtIso, 'releasedAtIso'),
  }
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`Invalid scheduler lease ${field}`)
  }
  return value
}

function readIso(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid scheduler lease ${field}`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Invalid scheduler lease ${field}`)
  }
  return value
}

function readNullableIso(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return readIso(value, field)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isHardLinkUnsupportedError(error: unknown): error is NodeJS.ErrnoException {
  return isNodeError(error) && (
    error.code === 'EACCES' ||
    error.code === 'EPERM' ||
    error.code === 'EOPNOTSUPP' ||
    error.code === 'ENOSYS' ||
    error.code === 'EXDEV'
  )
}
