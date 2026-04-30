import { join } from 'node:path'
import {
  ExecutionAuditLog,
  type ExecutionAuditEventInput,
  type ExecutionAuditRecord,
} from '../execution/auditLog'
import { projectHash } from './paths'
import { redactKanbanAuditValue } from './redaction'

export type KanbanAuditEventInput = ExecutionAuditEventInput & {
  eventType: string
  actor: Record<string, unknown>
  task: Record<string, unknown>
  repo: Record<string, unknown>
  codex: Record<string, unknown>
  policy: Record<string, unknown>
}

export type KanbanAuditRecord = ExecutionAuditRecord<KanbanAuditEventInput> & {
  source: 'kanban'
}

export type KanbanAuditSink = {
  append(input: KanbanAuditEventInput): Promise<KanbanAuditRecord>
}

export class KanbanAuditLog implements KanbanAuditSink {
  private readonly auditLog: ExecutionAuditLog<KanbanAuditEventInput>

  constructor(options: { dataDir: string; projectRoot: string }) {
    this.auditLog = new ExecutionAuditLog<KanbanAuditEventInput>({
      filePath: resolveProjectAuditLogPath(options.dataDir, options.projectRoot),
      source: 'kanban',
      redact: redactKanbanAuditValue,
      corruptMessage: 'Kanban audit log is corrupt',
    })
  }

  append(input: KanbanAuditEventInput): Promise<KanbanAuditRecord> {
    return this.auditLog.append(projectKanbanAuditInput(input)) as Promise<KanbanAuditRecord>
  }
}

export function resolveProjectAuditLogPath(dataDir: string, projectRoot: string): string {
  return join(dataDir, 'audit', `${projectHash(projectRoot)}.jsonl`)
}

function projectKanbanAuditInput(input: KanbanAuditEventInput): KanbanAuditEventInput {
  return {
    eventType: input.eventType,
    actor: input.actor,
    task: input.task,
    repo: input.repo,
    codex: input.codex,
    policy: input.policy,
  }
}
