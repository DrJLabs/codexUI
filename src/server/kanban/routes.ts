import { isAbsolute, resolve } from 'node:path'
import express, { type Request, type Response, type Router } from 'express'
import type { KanbanExecutionPolicy } from '../../types/kanban'
import { resolveKanbanConfig } from './config'
import { KanbanEventBus, formatSseEvent } from './eventBus'
import { resolveKanbanDataDir } from './paths'
import {
  parseCreateTaskInput,
  parseReplaceAcceptanceCriteriaInput,
  parseStatusInput,
  parseUpdateTaskInput,
} from './schema'
import { KanbanStorage } from './storage'
import { KanbanTaskService } from './taskService'

export type CreateKanbanRouterOptions = {
  dataDir?: string
  projectRoot?: string
  policy?: KanbanExecutionPolicy
  eventBus?: KanbanEventBus
}

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>

export function createKanbanRouter(options: CreateKanbanRouterOptions = {}): Router {
  const config = resolveKanbanConfig()
  const projectRoot = normalizeProjectRoot(options.projectRoot ?? process.cwd())
  const dataDir = resolveKanbanDataDir(options.dataDir ?? config.dataDir)
  const eventBus = options.eventBus ?? new KanbanEventBus()
  const service = new KanbanTaskService({
    storage: new KanbanStorage({ dataDir, projectRoot }),
    projectRoot,
    policy: options.policy ?? config.policy,
  })
  const router = express.Router()

  router.use(express.json({ limit: '1mb' }))

  router.get('/health', (_req, res) => {
    res.status(200).json({ data: { ok: true } })
  })

  router.get('/state', asyncHandler(async (_req, res) => {
    res.status(200).json({ data: await service.listState() })
  }))

  router.get('/events', (req, res) => {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Connection', 'keep-alive')
    let unsubscribe: (() => void) | null = null
    let isClosed = false
    const cleanup = () => {
      if (isClosed) return
      isClosed = true
      unsubscribe?.()
      unsubscribe = null
    }
    const writeEvent = (payload: string) => {
      try {
        res.write(payload)
      } catch {
        cleanup()
      }
    }
    writeEvent('event: ready\ndata: {"ok":true}\n\n')
    unsubscribe = eventBus.subscribe((event) => writeEvent(formatSseEvent(event)))
    req.on('close', cleanup)
    res.on('error', cleanup)
    req.socket.on('error', cleanup)
  })

  router.post('/tasks', asyncHandler(async (req, res) => {
    const task = await service.createTask(parseCreateTaskInput(req.body))
    eventBus.emit({ type: 'task.created', payload: { taskId: task.id } })
    res.status(201).json({ data: task })
  }))

  router.patch('/tasks/:taskId', asyncHandler(async (req, res) => {
    const task = await service.updateTask(readRouteParam(req.params.taskId, 'taskId'), parseUpdateTaskInput(req.body))
    eventBus.emit({ type: 'task.updated', payload: { taskId: task.id } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/status', asyncHandler(async (req, res) => {
    const task = await service.setTaskStatus(readRouteParam(req.params.taskId, 'taskId'), parseStatusInput(req.body))
    eventBus.emit({ type: 'task.status_changed', payload: { taskId: task.id, status: task.status } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/archive', asyncHandler(async (req, res) => {
    const task = await service.archiveTask(readRouteParam(req.params.taskId, 'taskId'))
    eventBus.emit({ type: 'task.updated', payload: { taskId: task.id, archived: true } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/criteria/replace', asyncHandler(async (req, res) => {
    const task = await service.replaceAcceptanceCriteria(readRouteParam(req.params.taskId, 'taskId'), parseReplaceAcceptanceCriteriaInput(req.body))
    eventBus.emit({ type: 'task.updated', payload: { taskId: task.id } })
    res.status(200).json({ data: task })
  }))

  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Kanban request failed'
    const status = resolveErrorStatus(message)
    res.status(status).json({ error: message })
  })

  return router
}

function asyncHandler(handler: AsyncRouteHandler): express.RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next)
  }
}

function normalizeProjectRoot(value: string): string {
  return isAbsolute(value) ? value : resolve(value)
}

function readRouteParam(value: string | string[] | undefined, name: string): string {
  const resolved = Array.isArray(value) ? value.join('/') : value
  if (!resolved) {
    throw new Error(`Missing route parameter: ${name}`)
  }
  return resolved
}

function resolveErrorStatus(message: string): number {
  const lowerMessage = message.toLowerCase()
  if (lowerMessage.includes('not found')) return 404
  if (
    lowerMessage.startsWith('task title is required')
    || lowerMessage.startsWith('invalid kanban status')
    || lowerMessage.startsWith('invalid status transition')
    || lowerMessage.startsWith('acceptance criteria must be an array')
    || lowerMessage.startsWith('missing route parameter')
  ) {
    return 400
  }
  return 500
}
