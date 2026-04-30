import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'

export const EXECUTION_AUDIT_SCHEMA = 'codexui.execution.audit.v1'

export type ExecutionAuditSource = 'kanban' | 'automation' | 'action'

const SECRET_FIELD_PATTERN = /(?:authorization|cookie|password|secret|token|api[_-]?key)/iu

export type ExecutionAuditEventInput = {
  eventType: string
  [key: string]: unknown
}

export type ExecutionAuditRecord<TInput extends ExecutionAuditEventInput = ExecutionAuditEventInput> = TInput & {
  schema: typeof EXECUTION_AUDIT_SCHEMA
  source: ExecutionAuditSource
  eventId: string
  ts: string
  prevEventHash: string | null
  eventHash: string
}

export type ExecutionAuditRedactor<TInput extends ExecutionAuditEventInput = ExecutionAuditEventInput> = (
  input: TInput,
) => TInput

export type ExecutionAuditAppendOptions<TInput extends ExecutionAuditEventInput = ExecutionAuditEventInput> = {
  redact?: ExecutionAuditRedactor<TInput>
}

export type ExecutionAuditLogOptions<TInput extends ExecutionAuditEventInput = ExecutionAuditEventInput> = {
  filePath: string
  source: ExecutionAuditSource
  redact?: ExecutionAuditRedactor<TInput>
  corruptMessage?: string
}

export class ExecutionAuditLog<TInput extends ExecutionAuditEventInput = ExecutionAuditEventInput> {
  private readonly filePath: string
  private readonly source: ExecutionAuditSource
  private readonly redact: ExecutionAuditRedactor<TInput> | undefined
  private readonly corruptMessage: string
  private writeQueue: Promise<void> = Promise.resolve()
  private lastEventHash: string | null | undefined

  constructor(options: ExecutionAuditLogOptions<TInput>) {
    this.filePath = options.filePath
    this.source = options.source
    this.redact = options.redact
    this.corruptMessage = options.corruptMessage ?? 'Execution audit log is corrupt'
  }

  append(
    input: TInput,
    options: ExecutionAuditAppendOptions<TInput> = {},
  ): Promise<ExecutionAuditRecord<TInput>> {
    const next = this.writeQueue.then(() => this.appendNow(input, options))
    this.writeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private async appendNow(
    input: TInput,
    options: ExecutionAuditAppendOptions<TInput>,
  ): Promise<ExecutionAuditRecord<TInput>> {
    const redactor = options.redact ?? this.redact
    const redacted = redactExecutionAuditValue(redactor ? redactor(input) : input)
    const prevEventHash = await this.readPreviousEventHash()
    const baseRecord = {
      ...redacted,
      schema: EXECUTION_AUDIT_SCHEMA,
      source: this.source,
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      prevEventHash,
    }
    const eventHash = createHash('sha256').update(canonicalJson(baseRecord)).digest('hex')
    const record = {
      ...baseRecord,
      eventHash,
    } as ExecutionAuditRecord<TInput>

    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    this.lastEventHash = record.eventHash
    return record
  }

  private async readPreviousEventHash(): Promise<string | null> {
    if (this.lastEventHash !== undefined) return this.lastEventHash
    const lastLine = await readLastNonEmptyLine(this.filePath)
    if (!lastLine) return null
    const lastRecord = JSON.parse(lastLine) as { eventHash?: unknown }
    if (typeof lastRecord.eventHash !== 'string' || !/^[a-f0-9]{64}$/u.test(lastRecord.eventHash)) {
      throw new Error(this.corruptMessage)
    }
    this.lastEventHash = lastRecord.eventHash
    return lastRecord.eventHash
  }
}

async function readLastNonEmptyLine(filePath: string): Promise<string | null> {
  let file: Awaited<ReturnType<typeof open>>
  try {
    file = await open(filePath, 'r')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
  try {
    const { size } = await file.stat()
    if (size === 0) return null
    const chunkSize = 4096
    let position = size
    let text = ''
    while (position > 0) {
      const readSize = Math.min(chunkSize, position)
      position -= readSize
      const buffer = Buffer.alloc(readSize)
      const { bytesRead } = await file.read(buffer, 0, readSize, position)
      text = buffer.subarray(0, bytesRead).toString('utf8') + text
      const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0)
      if (lines.length > 0 && (position === 0 || text.includes('\n'))) {
        return lines.at(-1) ?? null
      }
    }
    return text.trim() || null
  } finally {
    await file.close()
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

function redactExecutionAuditValue<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SECRET_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactValue(child)
  }
  return redacted
}
