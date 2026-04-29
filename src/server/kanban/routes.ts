import { isAbsolute, resolve } from 'node:path'
import express, { type Request, type Response, type Router } from 'express'
import type { KanbanExecutionPolicy } from '../../types/kanban'
import type { CodexBridgeRuntime } from '../codexAppServerBridge'
import { KanbanAuditLog, type KanbanAuditSink } from './auditLog'
import { resolveKanbanConfig } from './config'
import { CodexKanbanRunner } from './codexKanbanRunner'
import { KanbanCsrfProtection } from './csrf'
import { KanbanEventBus, formatSseEvent } from './eventBus'
import { createKanbanId } from './ids'
import { resolveKanbanDataDir } from './paths'
import { classifyKanbanRemoteAccess, type KanbanRemoteAccess } from './remoteAccess'
import {
  parseCreateTaskInput,
  parseReplaceAcceptanceCriteriaInput,
  parseStatusInput,
  parseUpdateTaskInput,
} from './schema'
import { KanbanProposalService } from './proposalService'
import { KanbanReviewPacketService } from './reviewPacketService'
import { KanbanStorage } from './storage'
import { KanbanTaskService } from './taskService'
import { KanbanWorktreeManager } from './worktreeManager'

export type CreateKanbanRouterOptions = {
  dataDir?: string
  projectRoot?: string
  policy?: KanbanExecutionPolicy
  eventBus?: KanbanEventBus
  auditLog?: KanbanAuditSink
  bridge?: CodexBridgeRuntime
}

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>

export function createKanbanRouter(options: CreateKanbanRouterOptions = {}): Router {
  const config = resolveKanbanConfig()
  const projectRoot = normalizeProjectRoot(options.projectRoot ?? process.cwd())
  const dataDir = resolveKanbanDataDir(options.dataDir ?? config.dataDir)
  const eventBus = options.eventBus ?? new KanbanEventBus()
  const auditLog = options.auditLog ?? new KanbanAuditLog({ dataDir, projectRoot })
  const csrf = new KanbanCsrfProtection()
  const sessionId = createKanbanId('session')
  const policy = options.policy ?? config.policy
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const service = new KanbanTaskService({
    storage,
    projectRoot,
    policy,
  })
  const reviewPackets = new KanbanReviewPacketService({ storage })
  const proposals = new KanbanProposalService({ storage, taskService: service })
  const worktreeManager = new KanbanWorktreeManager({ dataDir, projectRoot })
  const runner = options.bridge ? new CodexKanbanRunner({
    dataDir,
    projectRoot,
    storage,
    worktreeManager,
    bridge: options.bridge,
    auditLog,
  }) : null
  const router = express.Router()

  router.use(express.json({ limit: '1mb' }))

  router.get('/health', (_req, res) => {
    res.status(200).json({ data: { ok: true } })
  })

  router.get('/csrf', (req, res) => {
    assertTrustedAccessRequest(req)
    res.status(200).json({ data: { csrfToken: csrf.readToken() } })
  })

  router.get('/state', asyncHandler(async (_req, res) => {
    res.status(200).json({ data: await service.listState() })
  }))

  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
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
    if (isClosed) return
    unsubscribe = eventBus.subscribe((event) => {
      if (isClosed) return
      writeEvent(formatSseEvent(event))
    })
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

  router.post('/tasks/:taskId/run', asyncHandler(async (req, res) => {
    if (!policy.executionEnabled) {
      throw createHttpError(403, 'Kanban execution is disabled')
    }
    const access = assertTrustedAccessRequest(req)
    if (!csrf.verifyRequest(req)) {
      throw createHttpError(403, 'Invalid Kanban CSRF token')
    }
    const taskId = readRouteParam(req.params.taskId, 'taskId')
    await auditLog.append({
      eventType: runner ? 'run.preflight_passed' : 'run.preflight_blocked',
      actor: createAuditActor(access, sessionId),
      task: { taskId },
      repo: { projectRoot },
      codex: { runner: runner ? 'available' : 'not_wired' },
      policy: {
        executionEnabled: policy.executionEnabled,
        sandboxMode: policy.sandboxMode,
        approvalPolicy: policy.approvalPolicy,
        networkAccess: policy.networkAccess,
        useThreadShellCommand: policy.useThreadShellCommand,
      },
    })
    if (!runner) {
      res.status(409).json({ error: 'Kanban runner is not available yet' })
      return
    }
    const result = await runner.startTaskRun(taskId, { access, sessionId })
    eventBus.emit({ type: 'task.updated', payload: { taskId: result.task.id } })
    eventBus.emit({ type: 'run.started', payload: { runId: result.run.id, taskId: result.task.id, state: result.run.state } })
    res.status(202).json({ data: result })
  }))

  router.post('/runs/:runId/interrupt', asyncHandler(async (req, res) => {
    if (!policy.executionEnabled) {
      throw createHttpError(403, 'Kanban execution is disabled')
    }
    const access = assertTrustedAccessRequest(req)
    if (!csrf.verifyRequest(req)) {
      throw createHttpError(403, 'Invalid Kanban CSRF token')
    }
    if (!runner) {
      res.status(409).json({ error: 'Kanban runner is not available yet' })
      return
    }
    const result = await runner.interruptRun(readRouteParam(req.params.runId, 'runId'), { access, sessionId })
    if (result.task) {
      eventBus.emit({ type: 'task.updated', payload: { taskId: result.task.id } })
    }
    eventBus.emit({ type: 'run.cancelled', payload: { runId: result.run.id, taskId: result.run.taskId } })
    res.status(200).json({ data: result })
  }))

  router.get('/runs/:runId', asyncHandler(async (req, res) => {
    if (!runner) {
      res.status(404).json({ error: 'Kanban run not found' })
      return
    }
    res.status(200).json({ data: await runner.getRun(readRouteParam(req.params.runId, 'runId')) })
  }))

  router.get('/runs/:runId/logs', asyncHandler(async (req, res) => {
    if (!runner) {
      res.status(404).type('text/plain').send('')
      return
    }
    res.status(200).type('text/plain').send(await runner.readRunLogs(readRouteParam(req.params.runId, 'runId')))
  }))

  router.get('/runs/:runId/events', asyncHandler(async (req, res) => {
    if (!runner) {
      res.status(404).type('application/x-ndjson').send('')
      return
    }
    res.status(200).type('application/x-ndjson').send(await runner.readRunEvents(readRouteParam(req.params.runId, 'runId')))
  }))

  router.post('/runs/:runId/worktree/cleanup', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const runId = readRouteParam(req.params.runId, 'runId')
    const runState = await readStoredRunState(storage, runId)
    if (isActiveRunState(runState)) {
      throw createHttpError(409, `Cannot clean up active Kanban run ${runId}`)
    }
    await auditLog.append({
      eventType: 'worktree.cleanup_requested',
      actor: createAuditActor(classifyKanbanRemoteAccess(req), sessionId),
      task: { runId },
      repo: { projectRoot },
      codex: {},
      policy: { requiresConfirmation: true },
    })
    await worktreeManager.cleanupManagedWorktree({
      runId,
      confirmation: readString(req.body?.confirmation),
      activeRunIds: [],
    })
    res.status(200).json({ data: { ok: true } })
  }))

  router.get('/tasks/:taskId/review-packet', asyncHandler(async (req, res) => {
    const packet = await reviewPackets.getPacketForTask(readRouteParam(req.params.taskId, 'taskId'))
    if (!packet) {
      res.status(404).json({ error: 'Kanban review packet not found' })
      return
    }
    res.status(200).json({ data: packet })
  }))

  router.post('/tasks/:taskId/review-packet/regenerate', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const result = await reviewPackets.generateForTask(readRouteParam(req.params.taskId, 'taskId'))
    eventBus.emit({ type: 'task.updated', payload: { taskId: result.task.id } })
    res.status(200).json({ data: result })
  }))

  router.post('/tasks/:taskId/rework', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const task = await service.setTaskStatus(readRouteParam(req.params.taskId, 'taskId'), { status: 'rework' })
    eventBus.emit({ type: 'task.status_changed', payload: { taskId: task.id, status: task.status } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/review/approve', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const task = await service.setTaskStatus(readRouteParam(req.params.taskId, 'taskId'), { status: 'done' })
    eventBus.emit({ type: 'task.status_changed', payload: { taskId: task.id, status: task.status } })
    res.status(200).json({ data: task })
  }))

  router.post('/tasks/:taskId/review/reject', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const task = await service.setTaskStatus(readRouteParam(req.params.taskId, 'taskId'), { status: 'rework' })
    eventBus.emit({ type: 'task.status_changed', payload: { taskId: task.id, status: task.status } })
    res.status(200).json({ data: task })
  }))

  router.get('/proposals', asyncHandler(async (_req, res) => {
    res.status(200).json({ data: await proposals.listProposals() })
  }))

  router.post('/proposals/:proposalId/accept', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const proposal = await proposals.acceptProposal(readRouteParam(req.params.proposalId, 'proposalId'))
    eventBus.emit({ type: 'task.created', payload: { proposalId: proposal.id } })
    res.status(200).json({ data: proposal })
  }))

  router.post('/proposals/:proposalId/reject', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const proposal = await proposals.rejectProposal(readRouteParam(req.params.proposalId, 'proposalId'))
    res.status(200).json({ data: proposal })
  }))

  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Kanban request failed'
    const status = resolveErrorStatus(error, message)
    if (status >= 500) {
      console.error('Kanban API error:', error)
    }
    res.status(status).json({ error: status >= 500 ? 'Kanban request failed' : message })
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

function assertTrustedAccessRequest(req: Request): KanbanRemoteAccess {
  const access = classifyKanbanRemoteAccess(req)
  if (!access.trusted) {
    throw createHttpError(403, 'Kanban execution requires trusted local or Tailscale access')
  }
  return access
}

function assertTrustedAccessMutation(req: Request, csrf: KanbanCsrfProtection): KanbanRemoteAccess {
  const access = assertTrustedAccessRequest(req)
  if (!csrf.verifyRequest(req)) {
    throw createHttpError(403, 'Invalid Kanban CSRF token')
  }
  return access
}

function createAuditActor(access: KanbanRemoteAccess, sessionId: string): Record<string, unknown> {
  return {
    type: 'local-browser',
    sessionId,
    remoteAddress: access.remoteAddress,
    forwardedFor: access.forwardedFor,
    loopback: access.loopback,
    tailscale: access.tailscale,
    trusted: access.trusted,
    forwarded: access.forwarded,
  }
}

function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

async function readStoredRunState(storage: KanbanStorage, runId: string): Promise<string> {
  const state = await storage.load()
  const run = state.runs[runId]
  return run && typeof run === 'object' && 'state' in run && typeof run.state === 'string' ? run.state : ''
}

function isActiveRunState(state: string): boolean {
  return ['queued', 'preparing_worktree', 'starting_codex', 'running', 'waiting_for_approval', 'running_tests', 'collecting_artifacts', 'stopping'].includes(state)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function resolveErrorStatus(error: unknown, message: string): number {
  if (isHttpStatusError(error)) return error.status
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

function isHttpStatusError(error: unknown): error is { status: number } {
  return error !== null
    && typeof error === 'object'
    && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
    && (error as { status: number }).status >= 400
    && (error as { status: number }).status <= 599
}
