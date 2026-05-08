import express, { type Request, type RequestHandler } from 'express'
import { AUTOMATIONS_CSRF_HEADER, AutomationsCsrfProtection } from './csrf.js'
import { AutomationNotFoundError, getAutomationHttpStatus } from './errors.js'
import { assertAutomationExecutionAccess } from './policy.js'
import { classifyAutomationsRemoteAccess, type AutomationsRemoteAccess } from './remoteAccess.js'
import {
  parseAutomationCreateInput,
  parseAutomationDeleteOptions,
  parseAutomationPatchInput,
  parseAutomationRouteParams,
  parseHeartbeatThreadStateInput,
} from './schema.js'
import { AutomationsService, type AutomationsServiceOptions } from './service.js'

export type CreateAutomationsRouterOptions = AutomationsServiceOptions & {
  service?: AutomationsService
}

export function createAutomationsRouter(options: CreateAutomationsRouterOptions = {}): RequestHandler {
  const router = express.Router()
  const csrf = new AutomationsCsrfProtection()
  const service = options.service ?? new AutomationsService(options)

  router.use(express.json({ limit: '1mb' }) as express.RequestHandler)

  router.get('/health', (_req, res) => {
    res.status(200).json({ data: { ok: true } })
  })

  router.get('/csrf', (req, res) => {
    readAutomationsAccess(req)
    res.status(200).json({ data: { csrfToken: csrf.readToken(), headerName: AUTOMATIONS_CSRF_HEADER } })
  })

  router.get('/state', asyncHandler(async (req, res) => {
    readAutomationsAccess(req)
    res.status(200).json({ data: await service.listState() })
  }))

  router.get('/templates', (req, res) => {
    readAutomationsAccess(req)
    res.status(200).json({ data: service.listTemplates() })
  })

  router.get('/', asyncHandler(async (req, res) => {
    readAutomationsAccess(req)
    res.status(200).json({ data: await service.listDefinitions() })
  }))

  router.post('/', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    res.status(201).json({ data: await service.createDefinition(parseAutomationCreateInput(req.body)) })
  }))

  router.post('/heartbeat-thread-state', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    await service.recordHeartbeatThreadState(parseHeartbeatThreadStateInput(req.body))
    res.status(200).json({ data: { ok: true } })
  }))

  router.get('/:automationId', asyncHandler(async (req, res) => {
    readAutomationsAccess(req)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.getDefinition(automationId) })
  }))

  router.get('/:automationId/runs', asyncHandler(async (req, res) => {
    readAutomationsAccess(req)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.listRuns(automationId) })
  }))

  router.post('/:automationId/runs/:runId/read', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.markRunRead(automationId, readRouteString(req.params.runId, 'runId')) })
  }))

  router.post('/:automationId/runs/:runId/archive', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.archiveRun(automationId, readRouteString(req.params.runId, 'runId')) })
  }))

  router.post('/:automationId/runs/:runId/unarchive', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.unarchiveRun(automationId, readRouteString(req.params.runId, 'runId')) })
  }))

  router.post('/:automationId/run', asyncHandler(async (req, res) => {
    assertExecutionAccessMutation(req, csrf, service.getExecutionPolicy())
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(202).json({ data: await service.runNow(automationId) })
  }))

  router.patch('/:automationId', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.patchDefinition(automationId, parseAutomationPatchInput(req.body)) })
  }))

  router.post('/:automationId/pause', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.pauseDefinition(automationId) })
  }))

  router.post('/:automationId/resume', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.resumeDefinition(automationId) })
  }))

  router.delete('/:automationId', asyncHandler(async (req, res) => {
    assertAutomationsMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.deleteDefinition(automationId, parseAutomationDeleteOptions(req.query, req.body)) })
  }))

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = createStatus(error)
    const message = error instanceof Error ? error.message : 'Unexpected Automations API error'
    const payload: { error: string; code?: string } = {
      error: status === 500 ? 'Unexpected Automations API error' : message,
    }
    if (isRouteError(error) && error.code) payload.code = error.code
    res.status(status).json(payload)
  })

  return router
}

function asyncHandler(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

function createStatus(error: unknown): number {
  if (isStatusError(error)) return error.statusCode
  if (error instanceof AutomationNotFoundError) return 404
  return getAutomationHttpStatus(error)
}

function isStatusError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
}

function isRouteError(error: unknown): error is Error & { statusCode: number; code?: string } {
  return isStatusError(error)
}

function readAutomationsAccess(req: Request): AutomationsRemoteAccess {
  return classifyAutomationsRemoteAccess(req)
}

function assertAutomationsMutation(req: Request, csrf: AutomationsCsrfProtection): AutomationsRemoteAccess {
  const access = readAutomationsAccess(req)
  if (!csrf.verifyRequest(req)) {
    throw createRouteError(403, 'Invalid Automations CSRF token', 'AUTOMATIONS_CSRF_INVALID')
  }
  return access
}

function assertExecutionAccessMutation(
  req: Request,
  csrf: AutomationsCsrfProtection,
  policy: ReturnType<AutomationsService['getExecutionPolicy']>,
): AutomationsRemoteAccess {
  const access = classifyAutomationsRemoteAccess(req)
  assertAutomationExecutionAccess(access, policy)
  if (!csrf.verifyRequest(req)) {
    throw createRouteError(403, 'Invalid Automations CSRF token', 'AUTOMATIONS_CSRF_INVALID')
  }
  return access
}

function createRouteError(statusCode: number, message: string, code?: string): Error & { statusCode: number; code?: string } {
  const error = new Error(message) as Error & { statusCode: number; code?: string }
  error.statusCode = statusCode
  if (code) error.code = code
  return error
}

function readRouteString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim() && value.trim() === value && isSafeRouteSegment(value)) return value
  throw createRouteError(400, `${field} is required`)
}

function isSafeRouteSegment(value: string): boolean {
  return value !== '.' && value !== '..' && /^[A-Za-z0-9._-]+$/u.test(value)
}
