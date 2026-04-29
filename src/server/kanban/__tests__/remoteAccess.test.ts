import { describe, expect, it } from 'vitest'
import { classifyKanbanRemoteAccessFromParts } from '../remoteAccess'

describe('classifyKanbanRemoteAccessFromParts', () => {
  it('trusts loopback browser requests', () => {
    expect(classifyKanbanRemoteAccessFromParts({ remoteAddress: '127.0.0.1' })).toMatchObject({
      trusted: true,
      loopback: true,
      tailscale: false,
      reason: 'loopback',
    })
  })

  it('trusts direct Tailscale IPv4 clients', () => {
    expect(classifyKanbanRemoteAccessFromParts({ remoteAddress: '100.64.0.10' })).toMatchObject({
      trusted: true,
      loopback: false,
      tailscale: true,
      reason: 'tailscale',
    })
  })

  it('trusts Tailscale Serve forwarding from a loopback peer', () => {
    expect(classifyKanbanRemoteAccessFromParts({
      remoteAddress: '127.0.0.1',
      forwardedFor: '100.100.100.100',
    })).toMatchObject({
      trusted: true,
      loopback: false,
      tailscale: true,
      forwarded: true,
      reason: 'tailscale_serve_forwarded',
    })
  })

  it('does not trust spoofed forwarded headers from non-loopback peers', () => {
    expect(classifyKanbanRemoteAccessFromParts({
      remoteAddress: '192.168.1.50',
      forwardedFor: '100.100.100.100',
    })).toMatchObject({
      trusted: false,
      loopback: false,
      tailscale: false,
      forwarded: true,
      reason: 'untrusted_forwarded',
    })
  })

  it('does not trust non-Tailscale remote clients', () => {
    expect(classifyKanbanRemoteAccessFromParts({ remoteAddress: '192.168.1.50' })).toMatchObject({
      trusted: false,
      loopback: false,
      tailscale: false,
      reason: 'untrusted_remote',
    })
  })
})
