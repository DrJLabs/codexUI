export class AutomationNotFoundError extends Error {
  constructor(automationId: string) {
    super(`Automation not found: ${automationId}`)
    this.name = 'AutomationNotFoundError'
  }
}

export class AutomationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationValidationError'
  }
}

export class AutomationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationConflictError'
  }
}

export function getAutomationHttpStatus(error: unknown): number {
  if (error instanceof AutomationValidationError) return 400
  if (error instanceof AutomationConflictError) return 409
  if (error instanceof AutomationNotFoundError) return 404
  return 500
}
