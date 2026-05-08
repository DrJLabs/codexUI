import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import { classifyAutomationsRemoteAccess } from '../remoteAccess'

function requestWithRemoteAddress(remoteAddress: string, headers: Record<string, string> = {}): Request {
  return {
    socket: { remoteAddress },
    headers,
  } as unknown as Request
}

describe('automation remote access classification', () => {
  it('trusts loopback socket peers', () => {
    expect(classifyAutomationsRemoteAccess(requestWithRemoteAddress('127.0.0.1'))).toEqual({
      loopback: true,
    })
  })

  it('ignores spoofed forwarded-for loopback headers', () => {
    expect(classifyAutomationsRemoteAccess(requestWithRemoteAddress('203.0.113.10', {
      'x-forwarded-for': '127.0.0.1',
    }))).toEqual({
      loopback: false,
    })
  })

  it('does not infer access policy from hardcoded IP ranges', () => {
    expect(classifyAutomationsRemoteAccess(requestWithRemoteAddress('100.64.0.1'))).toEqual({
      loopback: false,
    })
  })
})
