import type { CreateKanbanTaskInput, UpdateKanbanTaskInput } from '../../types/kanban'
import { parseCreateTaskInput, parseUpdateTaskInput } from './schema'

export type KanbanMarker =
  | { type: 'create'; payload: CreateKanbanTaskInput }
  | { type: 'update'; payload: { taskId: string; patch: UpdateKanbanTaskInput } }

export type ParseKanbanMarkersResult = {
  cleanText: string
  markers: KanbanMarker[]
}

const KANBAN_MARKER_BLOCK = /(^|\n)(```kanban:(create|update)\r?\n([\s\S]*?)\r?\n```)/gu

export function parseKanbanMarkers(text: string): ParseKanbanMarkersResult {
  const markers: KanbanMarker[] = []
  let cleanText = ''
  let lastIndex = 0

  for (const match of text.matchAll(KANBAN_MARKER_BLOCK)) {
    const matchIndex = match.index ?? 0
    const leadingNewline = match[1] ?? ''
    const block = match[2] ?? ''
    const type = match[3]
    const rawJson = match[4] ?? ''
    const blockStart = matchIndex + leadingNewline.length
    const marker = parseMarker(type, rawJson)

    cleanText += text.slice(lastIndex, marker ? matchIndex : blockStart)
    if (marker) {
      markers.push(marker)
    } else {
      cleanText += block
    }
    lastIndex = blockStart + block.length
  }

  cleanText += text.slice(lastIndex)
  return {
    cleanText: cleanText.replace(/\n{3,}/gu, '\n\n').trim(),
    markers,
  }
}

function parseMarker(type: string | undefined, rawJson: string): KanbanMarker | null {
  let value: unknown
  try {
    value = JSON.parse(rawJson)
  } catch {
    return null
  }
  try {
    if (type === 'create') {
      return { type, payload: parseCreateTaskInput(value) }
    }
    if (type === 'update') {
      const payload = parseUpdatePayload(value)
      return { type, payload }
    }
  } catch {
    return null
  }
  return null
}

function parseUpdatePayload(value: unknown): { taskId: string; patch: UpdateKanbanTaskInput } {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
  if (!taskId) throw new Error('Kanban update marker taskId is required')
  return {
    taskId,
    patch: parseUpdateTaskInput(record.patch),
  }
}
