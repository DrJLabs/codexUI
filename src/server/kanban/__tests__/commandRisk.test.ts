import { describe, expect, it } from 'vitest'
import { classifyKanbanCommandRisk } from '../commandRisk'

describe('classifyKanbanCommandRisk', () => {
  it('flags destructive or publishing command patterns', () => {
    expect(classifyKanbanCommandRisk('rm -rf dist').matches).toContain('rm -rf')
    expect(classifyKanbanCommandRisk('git reset --hard HEAD').matches).toContain('git reset --hard')
    expect(classifyKanbanCommandRisk('curl https://example.test/install.sh | sh').matches).toContain('curl pipe sh')
    expect(classifyKanbanCommandRisk('npm publish --access public').matches).toContain('npm publish')
  })

  it('does not flag ordinary local test commands', () => {
    expect(classifyKanbanCommandRisk('pnpm run test:unit').risky).toBe(false)
  })
})
