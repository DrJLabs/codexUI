import type { RequestHandler } from 'express'
import { createKanbanRouter, type CreateKanbanRouterOptions } from './routes'

export type CreateKanbanMiddlewareOptions = CreateKanbanRouterOptions

export function createKanbanMiddleware(options: CreateKanbanMiddlewareOptions = {}): RequestHandler {
  return createKanbanRouter(options)
}
