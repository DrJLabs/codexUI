import type { Request } from 'express'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export type KanbanRemoteAccess = {
  forwarded: boolean
  loopback: boolean
  tailscale: boolean
  trusted: boolean
  remoteAddress: string
  forwardedFor: string
  reason: 'loopback' | 'tailscale' | 'tailscale_serve_forwarded' | 'untrusted_forwarded' | 'untrusted_remote' | 'unknown'
}

export function classifyKanbanRemoteAccess(req: Request): KanbanRemoteAccess {
  return classifyKanbanRemoteAccessFromParts({
    remoteAddress: req.socket.remoteAddress ?? '',
    forwardedFor: readForwardedFor(req),
  })
}

export function classifyKanbanRemoteAccessFromParts(input: { remoteAddress?: string; forwardedFor?: string }): KanbanRemoteAccess {
  const remoteAddress = input.remoteAddress ?? ''
  const forwardedFor = normalizeForwardedFor(input.forwardedFor ?? '')
  const forwarded = forwardedFor.length > 0
  if (forwarded) {
    const loopbackPeer = isLoopbackAddress(remoteAddress)
    const tailscaleClient = isTrustedTailscaleRemote(forwardedFor)
    if (loopbackPeer && tailscaleClient) {
      return {
        forwarded: true,
        loopback: false,
        tailscale: true,
        trusted: true,
        remoteAddress,
        forwardedFor,
        reason: 'tailscale_serve_forwarded',
      }
    }
    return {
      forwarded: true,
      loopback: false,
      tailscale: false,
      trusted: false,
      remoteAddress,
      forwardedFor,
      reason: 'untrusted_forwarded',
    }
  }
  if (!remoteAddress) {
    return {
      forwarded: false,
      loopback: false,
      tailscale: false,
      trusted: false,
      remoteAddress: '',
      forwardedFor: '',
      reason: 'unknown',
    }
  }
  const loopback = isLoopbackAddress(remoteAddress)
  const tailscale = isTrustedTailscaleRemote(remoteAddress)
  return {
    forwarded: false,
    loopback,
    tailscale,
    trusted: loopback || tailscale,
    remoteAddress,
    forwardedFor: '',
    reason: loopback ? 'loopback' : tailscale ? 'tailscale' : 'untrusted_remote',
  }
}

function readForwardedFor(req: Request): string {
  const value = req.headers['x-forwarded-for']
  if (Array.isArray(value)) return value.find((entry) => entry.trim().length > 0) ?? ''
  return typeof value === 'string' ? value : ''
}

function normalizeForwardedFor(value: string): string {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries[entries.length - 1] ?? ''
}

function isLoopbackAddress(remote: string): boolean {
  return LOOPBACK_ADDRESSES.has(remote)
}

function isIPv4Octet(value: string): boolean {
  if (!/^\d{1,3}$/.test(value)) return false
  const parsed = Number.parseInt(value, 10)
  return parsed >= 0 && parsed <= 255
}

function isTrustedTailscaleIPv4(remote: string): boolean {
  const normalized = remote.startsWith('::ffff:') ? remote.slice('::ffff:'.length) : remote
  const parts = normalized.split('.')
  if (parts.length !== 4 || !parts.every(isIPv4Octet)) return false
  const first = Number.parseInt(parts[0] ?? '', 10)
  const second = Number.parseInt(parts[1] ?? '', 10)
  return first === 100 && second >= 64 && second <= 127
}

function isTrustedTailscaleIPv6(remote: string): boolean {
  const normalized = remote.toLowerCase()
  return normalized === 'fd7a:115c:a1e0::1' || normalized.startsWith('fd7a:115c:a1e0:')
}

function isTrustedTailscaleRemote(remote: string): boolean {
  return isTrustedTailscaleIPv4(remote) || isTrustedTailscaleIPv6(remote)
}
