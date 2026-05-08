import type { Request } from 'express'

export type AutomationsRemoteAccess = {
  loopback: boolean
  tailscale: boolean
  trusted: boolean
}

export function classifyAutomationsRemoteAccess(req: Request): AutomationsRemoteAccess {
  const remoteAddress = req.socket.remoteAddress ?? ''
  const host = remoteAddress
  const loopback = host === '127.0.0.1' ||
    host === '::1' ||
    host === '::ffff:127.0.0.1' ||
    host === 'localhost'
  const tailscale = /^100\./u.test(host) || /^fd7a:115c:a1e0:/iu.test(host)
  return {
    loopback,
    tailscale,
    trusted: loopback || tailscale,
  }
}
