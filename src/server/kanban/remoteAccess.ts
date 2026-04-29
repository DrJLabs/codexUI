import type { Request } from 'express'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export type KanbanRemoteAccess = {
  forwarded: boolean
  loopback: boolean
  remoteAddress: string
  reason: 'loopback' | 'forwarded' | 'non_loopback' | 'unknown'
}

export function classifyKanbanRemoteAccess(req: Request): KanbanRemoteAccess {
  const forwarded = hasForwardedFor(req)
  const remoteAddress = req.socket.remoteAddress ?? ''
  if (forwarded) {
    return {
      forwarded: true,
      loopback: false,
      remoteAddress,
      reason: 'forwarded',
    }
  }
  if (!remoteAddress) {
    return {
      forwarded: false,
      loopback: false,
      remoteAddress: '',
      reason: 'unknown',
    }
  }
  const loopback = LOOPBACK_ADDRESSES.has(remoteAddress)
  return {
    forwarded: false,
    loopback,
    remoteAddress,
    reason: loopback ? 'loopback' : 'non_loopback',
  }
}

function hasForwardedFor(req: Request): boolean {
  const value = req.headers['x-forwarded-for']
  if (Array.isArray(value)) return value.some((entry) => entry.trim().length > 0)
  return typeof value === 'string' && value.trim().length > 0
}
