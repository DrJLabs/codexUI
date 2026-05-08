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
  return {
    loopback,
    tailscale: false,
    // The main app owns authentication. Automations should not add a
    // hardcoded IP-range trust layer that can drift from the app's access model.
    trusted: true,
  }
}
