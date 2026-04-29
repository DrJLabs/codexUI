import { randomUUID } from 'node:crypto'

export function createKanbanId(prefix: string): string {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  if (!safePrefix) {
    throw new Error('Kanban id prefix is required')
  }
  return `${safePrefix}_${randomUUID().replace(/-/gu, '')}`
}
