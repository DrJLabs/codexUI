import type { Request } from 'express'
import type { KanbanAccessContext } from '../../types/kanban'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export type KanbanRemoteAccess = {
  forwarded: boolean
  loopback: boolean
  tailscale: boolean
  trusted: boolean
  accessContext: KanbanAccessContext
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
        accessContext: 'tailscale',
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
      accessContext: classifyUntrustedAccessContext(remoteAddress, true),
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
      accessContext: 'unknown',
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
    accessContext: loopback ? 'loopback' : tailscale ? 'tailscale' : classifyUntrustedAccessContext(remoteAddress, false),
    remoteAddress,
    forwardedFor: '',
    reason: loopback ? 'loopback' : tailscale ? 'tailscale' : 'untrusted_remote',
  }
}

function classifyUntrustedAccessContext(remote: string, forwarded: boolean): KanbanAccessContext {
  if (forwarded) return 'public'
  const normalized = remote.startsWith('::ffff:') ? remote.slice('::ffff:'.length) : remote
  if (/^10\./u.test(normalized) || /^192\.168\./u.test(normalized) || /^172\.(1[6-9]|2\d|3[0-1])\./u.test(normalized)) {
    return 'lan'
  }
  if (isPrivateIPv6Lan(normalized)) return 'lan'
  if (!remote) return 'unknown'
  return 'public'
}

function readForwardedFor(req: Request): string {
  const value = req.headers['x-forwarded-for']
  if (Array.isArray(value)) return value.find((entry) => entry.trim().length > 0) ?? ''
  return typeof value === 'string' ? value : ''
}

function normalizeForwardedFor(value: string): string {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  if (entries.length !== 1) return entries.join(', ')
  return entries[0] ?? ''
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

function isPrivateIPv6Lan(remote: string): boolean {
  const normalized = remote.toLowerCase()
  return /^f[cd][0-9a-f]{2}:/u.test(normalized) || /^fe[89ab][0-9a-f]:/u.test(normalized)
}
