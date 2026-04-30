import express, { type Request, type RequestHandler } from 'express'
import { AUTOMATIONS_CSRF_HEADER, AutomationsCsrfProtection } from './csrf.js'
import { AutomationNotFoundError, getAutomationHttpStatus } from './errors.js'
import { classifyAutomationsRemoteAccess, type AutomationsRemoteAccess } from './remoteAccess.js'
import {
  parseAutomationCreateInput,
  parseAutomationDeleteOptions,
  parseAutomationPatchInput,
  parseAutomationRouteParams,
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
    assertTrustedAccessRequest(req)
    res.status(200).json({ data: { csrfToken: csrf.readToken(), headerName: AUTOMATIONS_CSRF_HEADER } })
  })

  router.get('/state', asyncHandler(async (_req, res) => {
    res.status(200).json({ data: await service.listState() })
  }))

  router.get('/templates', (_req, res) => {
    res.status(200).json({ data: service.listTemplates() })
  })

  router.get('/', asyncHandler(async (_req, res) => {
    res.status(200).json({ data: await service.listDefinitions() })
  }))

  router.post('/', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    res.status(201).json({ data: await service.createDefinition(parseAutomationCreateInput(req.body)) })
  }))

  router.get('/:automationId', asyncHandler(async (req, res) => {
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.getDefinition(automationId) })
  }))

  router.patch('/:automationId', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.patchDefinition(automationId, parseAutomationPatchInput(req.body)) })
  }))

  router.post('/:automationId/pause', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.pauseDefinition(automationId) })
  }))

  router.post('/:automationId/resume', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.resumeDefinition(automationId) })
  }))

  router.delete('/:automationId', asyncHandler(async (req, res) => {
    assertTrustedAccessMutation(req, csrf)
    const { automationId } = parseAutomationRouteParams(req.params)
    res.status(200).json({ data: await service.deleteDefinition(automationId, parseAutomationDeleteOptions(req.query, req.body)) })
  }))

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = createStatus(error)
    const message = error instanceof Error ? error.message : 'Unexpected Automations API error'
    res.status(status).json({ error: status === 500 ? 'Unexpected Automations API error' : message })
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

function assertTrustedAccessRequest(req: Request): AutomationsRemoteAccess {
  const access = classifyAutomationsRemoteAccess(req)
  if (!access.trusted) {
    throw createRouteError(403, 'Automations API requires trusted local or Tailscale access')
  }
  return access
}

function assertTrustedAccessMutation(req: Request, csrf: AutomationsCsrfProtection): AutomationsRemoteAccess {
  const access = assertTrustedAccessRequest(req)
  if (!csrf.verifyRequest(req)) {
    throw createRouteError(403, 'Invalid Automations CSRF token')
  }
  return access
}

function createRouteError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}
