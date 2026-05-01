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
  const schedulerEnabled = options.enableScheduler === true && service.isExecutionEnabled()
  const router = createAutomationsRouter({
    ...options,
    service,
    enableScheduler: schedulerEnabled,
  }) as AutomationsRequestHandler
  const scheduler = schedulerEnabled && options.bridge
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
