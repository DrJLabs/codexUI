import type { Request } from 'express'

export type AutomationsRemoteAccess = {
  loopback: boolean
}

export function classifyAutomationsRemoteAccess(req: Request): AutomationsRemoteAccess {
  const remoteAddress = req.socket.remoteAddress ?? ''
  const host = remoteAddress
  const loopback = host === '127.0.0.1' ||
    host === '::1' ||
    host === '::ffff:127.0.0.1' ||
    host === 'localhost'
  return {
    loopback,
  }
}
