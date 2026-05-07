import { describe, expect, it } from 'vitest'
import { classifyAutomationRunFailure, classifyAutomationRunResult } from '../resultClassifier'

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

  it('classifies failures as unread findings', () => {
    expect(classifyAutomationRunFailure('Bridge failed')).toMatchObject({
      state: 'failed',
      findings: true,
      inboxTitle: 'Run failed',
      inboxSummary: 'Bridge failed',
    })
  })
})
