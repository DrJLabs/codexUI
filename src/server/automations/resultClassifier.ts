import type { AutomationRunState } from '../../types/automations'

export type AutomationRunClassification = {
  state: AutomationRunState
  findings: boolean
  inboxTitle: string
  inboxSummary: string
}

export function classifyAutomationRunResult(text: string): AutomationRunClassification {
  const normalized = text.trim()
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

function summarizeInboxText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 240)
}
