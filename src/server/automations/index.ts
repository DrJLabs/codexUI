import type { RequestHandler } from 'express'
import { createAutomationsRouter, type CreateAutomationsRouterOptions } from './routes.js'

export type CreateAutomationsMiddlewareOptions = CreateAutomationsRouterOptions

export function createAutomationsMiddleware(options: CreateAutomationsMiddlewareOptions = {}): RequestHandler {
  return createAutomationsRouter(options)
}
