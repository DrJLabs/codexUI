import { describe, expect, it } from 'vitest'
import { classifyStartupRecovery } from '../recoveryService'

describe('classifyStartupRecovery', () => {
  it('prioritizes dead process and dirty worktree evidence over live turn hints', () => {
    expect(classifyStartupRecovery('running', {
      liveCodexTurnProven: true,
      processAlive: false,
    })).toBe('orphaned_process')
    expect(classifyStartupRecovery('running', {
      liveCodexTurnProven: true,
      worktreeDirty: true,
    })).toBe('crashed_with_changes')
  })
})
