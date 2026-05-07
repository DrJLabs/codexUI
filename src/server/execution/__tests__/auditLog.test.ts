import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExecutionAuditLog } from '../auditLog'

async function createHarness(source: 'kanban' | 'automation' | 'action' = 'automation') {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-execution-audit-'))
  const filePath = join(dataDir, 'audit.jsonl')
  return {
    filePath,
    auditLog: new ExecutionAuditLog({ filePath, source }),
  }
}

function createEvent(eventType = 'run.started') {
  return {
    eventType,
    actor: { type: 'local-browser' },
    target: { id: 'target_1' },
    codex: { threadId: 'thread_1' },
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value))
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortForCanonicalJson(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForCanonicalJson(child)]),
  )
}

function hashRecordWithoutEventHash(record: Record<string, unknown>): string {
  const baseRecord = { ...record }
  delete baseRecord.eventHash
  return createHash('sha256').update(canonicalJson(baseRecord)).digest('hex')
}

describe('ExecutionAuditLog', () => {
  it('appends execution schema records with source and hash chaining', async () => {
    const { auditLog, filePath } = await createHarness('automation')

    const first = await auditLog.append(createEvent('run.started'))
    const second = await auditLog.append(createEvent('run.completed'))
    const content = await readFile(filePath, 'utf8')
    const lines = content.trim().split('\n').map((line) => JSON.parse(line))

    expect(first.schema).toBe('codexui.execution.audit.v1')
    expect(first.source).toBe('automation')
    expect(first.prevEventHash).toBeNull()
    expect(first.eventHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(second.prevEventHash).toBe(first.eventHash)
    expect(second.source).toBe('automation')
    expect(lines).toHaveLength(2)
    expect(lines[0].eventHash).toBe(hashRecordWithoutEventHash(lines[0]))
    expect(lines[1].eventHash).toBe(hashRecordWithoutEventHash(lines[1]))
  })

  it('continues the hash chain from an existing legacy Kanban v1 record', async () => {
    const { auditLog, filePath } = await createHarness('kanban')
    const legacyRecord = {
      schema: 'codexui.kanban.audit.v1',
      eventId: 'legacy_event',
      ts: '2026-04-30T00:00:00.000Z',
      prevEventHash: null,
      eventHash: 'a'.repeat(64),
      eventType: 'run.preflight_started',
    }
    await writeFile(filePath, `${JSON.stringify(legacyRecord)}\n`, 'utf8')

    const next = await auditLog.append(createEvent('run.preflight_blocked'))
    const content = await readFile(filePath, 'utf8')
    const lines = content.trim().split('\n').map((line) => JSON.parse(line))

    expect(next.schema).toBe('codexui.execution.audit.v1')
    expect(next.source).toBe('kanban')
    expect(next.prevEventHash).toBe(legacyRecord.eventHash)
    expect(lines[0]).toEqual(legacyRecord)
    expect(lines[1].prevEventHash).toBe(legacyRecord.eventHash)
  })

  it('serializes concurrent appends from separate instances for the same file', async () => {
    const { filePath } = await createHarness('automation')
    const firstLog = new ExecutionAuditLog({ filePath, source: 'automation' })
    const secondLog = new ExecutionAuditLog({ filePath, source: 'automation' })

    await Promise.all([
      firstLog.append(createEvent('run.first')),
      secondLog.append(createEvent('run.second')),
    ])
    const lines = (await readFile(filePath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))

    expect(lines).toHaveLength(2)
    expect(lines[0].prevEventHash).toBeNull()
    expect(lines[1].prevEventHash).toBe(lines[0].eventHash)
  })

  it('redacts input before hashing and persistence', async () => {
    const { auditLog, filePath } = await createHarness('action')

    const record = await auditLog.append(
      {
        ...createEvent('action.executed'),
        codex: { authorization: 'Bearer secret-token' },
      },
      {
        redact: (value) => ({
          ...value,
          codex: { authorization: '[REDACTED]' },
        }),
      },
    )
    const content = await readFile(filePath, 'utf8')
    const persisted = JSON.parse(content.trim())

    expect(record.codex).toEqual({ authorization: '[REDACTED]' })
    expect(content).not.toContain('secret-token')
    expect(persisted.eventHash).toBe(hashRecordWithoutEventHash(persisted))
  })

  it('redacts secret-shaped fields by default before hashing and persistence', async () => {
    const { auditLog, filePath } = await createHarness('automation')

    const record = await auditLog.append({
      ...createEvent('run.started'),
      codex: {
        threadId: 'thread_1',
        authorization: 'Bearer default-secret-token',
      },
      env: {
        apiKey: 'sk-default-secret',
      },
    })
    const content = await readFile(filePath, 'utf8')
    const persisted = JSON.parse(content.trim())

    expect(record.codex).toEqual({ threadId: 'thread_1', authorization: '[REDACTED]' })
    expect(record.env).toEqual({ apiKey: '[REDACTED]' })
    expect(content).not.toContain('default-secret-token')
    expect(content).not.toContain('sk-default-secret')
    expect(persisted.eventHash).toBe(hashRecordWithoutEventHash(persisted))
  })
})
