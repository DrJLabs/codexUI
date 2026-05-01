import type { RequestHandler } from 'express'
import { AutomationScheduler } from './scheduler.js'
import { createAutomationsRouter, type CreateAutomationsRouterOptions } from './routes.js'
import { AutomationsService } from './service.js'

export type AutomationsRequestHandler = RequestHandler & {
  dispose?: () => void
}

export type CreateAutomationsMiddlewareOptions = CreateAutomationsRouterOptions & {
  enableScheduler?: boolean
  schedulerIntervalMs?: number
}

export function createAutomationsMiddleware(options: CreateAutomationsMiddlewareOptions = {}): AutomationsRequestHandler {
  const ownsService = !options.service
  const service = options.service ?? new AutomationsService({
    ...options,
    enableScheduler: options.enableScheduler === true,
  })
  const router = createAutomationsRouter({
    ...options,
    service,
    enableScheduler: options.enableScheduler === true,
  }) as AutomationsRequestHandler
  const scheduler = options.enableScheduler === true && options.bridge
    ? new AutomationScheduler({
        service,
        intervalMs: options.schedulerIntervalMs,
      })
    : null
  scheduler?.start()
  router.dispose = () => {
    scheduler?.stop()
    if (ownsService) service.dispose()
  }
  return router
}
