import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { projectHash } from './paths'
import { redactKanbanAuditValue } from './redaction'

export type KanbanAuditEventInput = {
  eventType: string
  actor: Record<string, unknown>
  task: Record<string, unknown>
  repo: Record<string, unknown>
  codex: Record<string, unknown>
  policy: Record<string, unknown>
}

export type KanbanAuditRecord = KanbanAuditEventInput & {
  schema: 'codexui.kanban.audit.v1'
  eventId: string
  ts: string
  prevEventHash: string | null
  eventHash: string
}

export type KanbanAuditSink = {
  append(input: KanbanAuditEventInput): Promise<KanbanAuditRecord>
}

export class KanbanAuditLog implements KanbanAuditSink {
  private readonly filePath: string
  private writeQueue: Promise<void> = Promise.resolve()
  private lastEventHash: string | null | undefined

  constructor(options: { dataDir: string; projectRoot: string }) {
    this.filePath = resolveProjectAuditLogPath(options.dataDir, options.projectRoot)
  }

  append(input: KanbanAuditEventInput): Promise<KanbanAuditRecord> {
    const next = this.writeQueue.then(() => this.appendNow(input))
    this.writeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private async appendNow(input: KanbanAuditEventInput): Promise<KanbanAuditRecord> {
    const redacted = redactKanbanAuditValue(input)
    const prevEventHash = await this.readPreviousEventHash()
    const baseRecord = {
      schema: 'codexui.kanban.audit.v1' as const,
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      prevEventHash,
      eventType: redacted.eventType,
      actor: redacted.actor,
      task: redacted.task,
      repo: redacted.repo,
      codex: redacted.codex,
      policy: redacted.policy,
    }
    const eventHash = createHash('sha256').update(canonicalJson(baseRecord)).digest('hex')
    const record: KanbanAuditRecord = {
      ...baseRecord,
      eventHash,
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    this.lastEventHash = record.eventHash
    return record
  }

  private async readPreviousEventHash(): Promise<string | null> {
    if (this.lastEventHash !== undefined) return this.lastEventHash
    let content = ''
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    }
    const lastLine = content.trim().split('\n').filter(Boolean).at(-1)
    if (!lastLine) return null
    const lastRecord = JSON.parse(lastLine) as { eventHash?: unknown }
    if (typeof lastRecord.eventHash !== 'string' || !/^[a-f0-9]{64}$/u.test(lastRecord.eventHash)) {
      throw new Error('Kanban audit log is corrupt')
    }
    this.lastEventHash = lastRecord.eventHash
    return lastRecord.eventHash
  }
}

export function resolveProjectAuditLogPath(dataDir: string, projectRoot: string): string {
  return join(dataDir, 'audit', `${projectHash(projectRoot)}.jsonl`)
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
