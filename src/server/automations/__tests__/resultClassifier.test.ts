import { describe, expect, it } from 'vitest'
import { classifyAutomationRunFailure, classifyAutomationRunResult, stripAutomationInboxDirectives } from '../resultClassifier'

describe('automation result classifier', () => {
  it('classifies explicit findings results as unread completed findings', () => {
    expect(classifyAutomationRunResult('RESULT: FINDINGS\n- Disk is full')).toMatchObject({
      state: 'completed_with_findings',
      findings: true,
      inboxTitle: 'Findings reported',
      inboxSummary: 'RESULT: FINDINGS - Disk is full',
    })
  })

  it('classifies explicit no findings results as completed no findings', () => {
    expect(classifyAutomationRunResult('RESULT: NO_FINDINGS\nNothing changed.')).toMatchObject({
      state: 'completed_no_findings',
      findings: false,
      inboxTitle: 'No findings',
    })
  })

  it('uses Desktop inbox directives as the run inbox item', () => {
    expect(classifyAutomationRunResult('Done.\n::inbox-item{title="PR comments addressed" summary="Ready for re-review; focus on auth edge case"}')).toMatchObject({
      state: 'completed_with_findings',
      findings: true,
      inboxTitle: 'PR comments addressed',
      inboxSummary: 'Ready for re-review; focus on auth edge case',
    })
  })

  it('strips Desktop inbox directives from stored run summaries', () => {
    expect(stripAutomationInboxDirectives('Done.\n::inbox-item{title="PR comments addressed" summary="Ready for re-review"}')).toBe('Done.')
  })

  it('classifies failures as unread findings', () => {
    expect(classifyAutomationRunFailure('Bridge failed')).toMatchObject({
      state: 'failed',
      findings: true,
      inboxTitle: 'Run failed',
      inboxSummary: 'Bridge failed',
    })
  })
})
