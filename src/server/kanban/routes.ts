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
    res.write('event: ready\ndata: {"ok":true}\n\n')
    const unsubscribe = eventBus.subscribe((event) => res.write(formatSseEvent(event)))
    req.on('close', unsubscribe)
  })

  router.post('/tasks', asyncHandler(async (req, res) => {
    const task = await service.createTask(parseCreateTaskInput(req.body))
    eventBus.emit({ type: 'task.created', payload: { taskId: task.id } })
    res.status(201).json({ data: task })
  }))

  router.patch('/tasks/:taskId', asyncHandler(async (req, res) => {
    const task = await service.updateTask(readRouteParam(req.params.taskId), parseUpdateTaskInput(req.body))
    eventBus.emit({ type: 'task.updated', payload: { taskId: task.id } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/status', asyncHandler(async (req, res) => {
    const task = await service.setTaskStatus(readRouteParam(req.params.taskId), parseStatusInput(req.body))
    eventBus.emit({ type: 'task.status_changed', payload: { taskId: task.id, status: task.status } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/archive', asyncHandler(async (req, res) => {
    const task = await service.archiveTask(readRouteParam(req.params.taskId))
    eventBus.emit({ type: 'task.updated', payload: { taskId: task.id, archived: true } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/criteria/replace', asyncHandler(async (req, res) => {
    const task = await service.replaceAcceptanceCriteria(readRouteParam(req.params.taskId), parseReplaceAcceptanceCriteriaInput(req.body))
    eventBus.emit({ type: 'task.updated', payload: { taskId: task.id } })
    res.status(200).json({ data: task })
  }))

  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Kanban request failed'
    const status = message.includes('not found') ? 404 : 400
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

function readRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('/')
  return value ?? ''
}
