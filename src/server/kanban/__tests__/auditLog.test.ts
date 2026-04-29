import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KanbanAuditLog, resolveProjectAuditLogPath } from '../auditLog'

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-audit-'))
  const projectRoot = join(dataDir, 'project')
  return {
    dataDir,
    projectRoot,
    auditLog: new KanbanAuditLog({ dataDir, projectRoot }),
  }
}

function createEvent(projectRoot: string, eventType = 'run.preflight_blocked') {
  return {
    eventType,
    actor: {
      type: 'local-browser',
      sessionId: 'session_1',
      remoteAddress: '127.0.0.1',
      loopback: true,
      forwarded: false,
      accessContext: 'loopback',
    },
    task: { taskId: 'task_1' },
    repo: { projectRoot },
    codex: {
      threadId: 'thread_1',
      authorization: 'Bearer secret-token',
    },
    policy: {
      executionMode: 'trusted_remote',
      executionEnabled: true,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    },
  }
}

describe('KanbanAuditLog', () => {
  it('appends a hash-chained JSONL audit stream', async () => {
    const { dataDir, projectRoot, auditLog } = await createHarness()

    const first = await auditLog.append(createEvent(projectRoot, 'run.preflight_started'))
    const second = await auditLog.append(createEvent(projectRoot, 'run.preflight_blocked'))
    const content = await readFile(resolveProjectAuditLogPath(dataDir, projectRoot), 'utf8')
    const lines = content.trim().split('\n')

    expect(first.schema).toBe('codexui.kanban.audit.v1')
    expect(first.prevEventHash).toBeNull()
    expect(first.eventHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(second.prevEventHash).toBe(first.eventHash)
    expect(second.eventHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1] ?? '{}').prevEventHash).toBe(first.eventHash)
  })

  it('redacts secret-shaped fields before hashing and persistence', async () => {
    const { dataDir, projectRoot, auditLog } = await createHarness()

    const record = await auditLog.append(createEvent(projectRoot))
    const content = await readFile(resolveProjectAuditLogPath(dataDir, projectRoot), 'utf8')

    expect(record.codex.authorization).toBe('[REDACTED]')
    expect(content).not.toContain('secret-token')
    expect(content).toContain('[REDACTED]')
  })
})
