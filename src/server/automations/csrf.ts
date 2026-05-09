import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'

export const AUTOMATIONS_CSRF_HEADER = 'x-codexui-automations-csrf'

export class AutomationsCsrfProtection {
  readonly token = randomBytes(32).toString('base64url')

  readToken(): string {
    return this.token
  }

  verifyRequest(req: Request): boolean {
    const header = req.get(AUTOMATIONS_CSRF_HEADER)
    if (!header) return false
    const expected = Buffer.from(this.token)
    const received = Buffer.from(header)
    return received.length === expected.length && timingSafeEqual(received, expected)
  }
}
