import type { AutomationRunState } from '../../types/automations'

export type AutomationRunClassification = {
  state: AutomationRunState
  findings: boolean
  inboxTitle: string
  inboxSummary: string
}

type InboxItemDirective = {
  title: string
  summary: string
}

export function classifyAutomationRunResult(text: string): AutomationRunClassification {
  const normalized = text.trim()
  const inboxItem = findInboxItemDirective(normalized)
  if (inboxItem) {
    return {
      state: 'completed_with_findings',
      findings: true,
      inboxTitle: inboxItem.title,
      inboxSummary: inboxItem.summary,
    }
  }
  const hasFindings = /\bRESULT:\s*(FINDINGS|FOUND|ACTION_REQUIRED)\b/iu.test(normalized) ||
    (/\bfindings?\s*:/iu.test(normalized) && !/\bfindings?\s*:\s*(none|no\b|0\b)/iu.test(normalized))
  return {
    state: hasFindings ? 'completed_with_findings' : 'completed_no_findings',
    findings: hasFindings,
    inboxTitle: hasFindings ? 'Findings reported' : 'No findings',
    inboxSummary: summarizeInboxText(normalized || 'Automation completed.'),
  }
}

export function classifyAutomationRunFailure(message: string): AutomationRunClassification {
  return {
    state: 'failed',
    findings: true,
    inboxTitle: 'Run failed',
    inboxSummary: summarizeInboxText(message || 'Automation run failed.'),
  }
}

export function stripAutomationInboxDirectives(text: string): string {
  const stripped = text
    .split(/\r?\n/u)
    .filter((line) => !parseInboxItemDirective(line.trim()))
    .join('\n')
    .trim()
  return stripped || 'Automation completed.'
}

function summarizeInboxText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

function parseInboxItemDirective(text: string): InboxItemDirective | null {
  const match = text.match(/^::inbox-item\{([\s\S]*)\}$/u)
  if (!match) return null
  const attrs = parseDirectiveAttributes(match[1] ?? '')
  const title = summarizeInboxText(attrs.title ?? '')
  const summary = summarizeInboxText(attrs.summary ?? '')
  if (!title || !summary) return null
  return { title, summary }
}

function findInboxItemDirective(text: string): InboxItemDirective | null {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const directive = parseInboxItemDirective(lines[index] ?? '')
    if (directive) return directive
  }
  return null
}

function parseDirectiveAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrPattern = /([A-Za-z][\w-]*)="((?:\\.|[^"\\])*)"/gu
  for (const match of raw.matchAll(attrPattern)) {
    const key = match[1]
    if (!key) continue
    attrs[key] = unescapeDirectiveValue(match[2] ?? '')
  }
  return attrs
}

function unescapeDirectiveValue(value: string): string {
  return value
    .replace(/\\n/gu, '\n')
    .replace(/\\t/gu, '\t')
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, '\\')
}
