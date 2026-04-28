import { EventEmitter } from 'node:events'

export type KanbanEvent = {
  type: string
  atIso: string
  payload: unknown
}

export class KanbanEventBus {
  private readonly emitter = new EventEmitter()

  emit(event: Omit<KanbanEvent, 'atIso'>): void {
    this.emitter.emit('event', {
      ...event,
      atIso: new Date().toISOString(),
    } satisfies KanbanEvent)
  }

  subscribe(listener: (event: KanbanEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => this.emitter.off('event', listener)
  }
}

export function formatSseEvent(event: KanbanEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
