const SECRET_FIELD_PATTERN = /(?:authorization|cookie|password|secret|token|api[_-]?key)/iu

export function redactKanbanAuditValue<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SECRET_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactValue(child)
  }
  return redacted
}
