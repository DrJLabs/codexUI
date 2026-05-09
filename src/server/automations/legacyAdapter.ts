import type { ThreadAutomationStatus } from './nativeStore.js'

export type ThreadAutomationWritePayload = {
  threadId: string
  name: string
  prompt: string
  rrule: string
  status: ThreadAutomationStatus
}

function readStringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeThreadAutomationStatus(value: unknown): ThreadAutomationStatus {
  if (typeof value !== 'string') return 'ACTIVE'
  const status = value.trim().toUpperCase()
  if (status === 'PAUSED' || status === 'DELETED') return status
  return 'ACTIVE'
}

export function parseThreadAutomationWritePayload(payload: Record<string, unknown> | null): ThreadAutomationWritePayload {
  const record = payload ?? {}
  return {
    threadId: readStringField(record, 'threadId'),
    name: readStringField(record, 'name'),
    prompt: readStringField(record, 'prompt'),
    rrule: readStringField(record, 'rrule'),
    status: normalizeThreadAutomationStatus(record.status),
  }
}
