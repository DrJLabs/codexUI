import { describe, expect, it } from 'vitest'
import { resolveKanbanConfig } from '../config'
import { createKanbanId } from '../ids'
import { projectHash, resolveKanbanDataDir, resolveProjectRunDir, resolveProjectStatePath } from '../paths'

describe('resolveKanbanConfig', () => {
  it('keeps execution disabled by default and pins safe Codex policy', () => {
    const config = resolveKanbanConfig({})

    expect(config.policy.executionEnabled).toBe(false)
    expect(config.policy.sandboxMode).toBe('workspace-write')
    expect(config.policy.approvalPolicy).toBe('on-request')
    expect(config.policy.networkAccess).toBe(false)
    expect(config.policy.allowDangerFullAccess).toBe(false)
    expect(config.policy.allowApprovalNever).toBe(false)
  })

  it('enables execution only from CODEXUI_KANBAN_EXECUTION_ENABLED=1', () => {
    expect(resolveKanbanConfig({ CODEXUI_KANBAN_EXECUTION_ENABLED: '1' }).policy.executionEnabled).toBe(true)
    expect(resolveKanbanConfig({ CODEXUI_KANBAN_EXECUTION_ENABLED: 'true' }).policy.executionEnabled).toBe(false)
  })

  it('keeps a configured data directory separate from the safe policy envelope', () => {
    const config = resolveKanbanConfig({
      CODEXUI_KANBAN_DATA_DIR: '/tmp/codexui-kanban',
      CODEXUI_KANBAN_EXECUTION_ENABLED: '1',
    })

    expect(config.dataDir).toBe('/tmp/codexui-kanban')
    expect(config.policy.useThreadShellCommand).toBe(false)
    expect(config.policy.maxGlobalActiveRuns).toBe(1)
  })
})

describe('kanban id and path helpers', () => {
  it('creates prefixed ids without dash characters', () => {
    const id = createKanbanId('task')

    expect(id).toMatch(/^task_[a-f0-9]{32}$/)
  })

  it('resolves default and project-scoped storage paths', () => {
    const dataDir = resolveKanbanDataDir('', '/home/tester')
    const hash = projectHash('/home/tester/project')

    expect(dataDir).toBe('/home/tester/.codex/codexui-kanban')
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
    expect(resolveProjectStatePath(dataDir, '/home/tester/project')).toBe(`${dataDir}/state/${hash}.json`)
    expect(resolveProjectRunDir(dataDir, '/home/tester/project', 'run_123')).toBe(`${dataDir}/runs/${hash}/run_123`)
  })

  it('uses CODEX_HOME as the default storage parent when provided', () => {
    expect(resolveKanbanDataDir('', '/home/tester', '/tmp/codex-home')).toBe('/tmp/codex-home/codexui-kanban')
  })
})
