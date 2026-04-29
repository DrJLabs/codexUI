import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { CodexBridgeRuntime } from '../../codexAppServerBridge'
import { KanbanAuditLog } from '../auditLog'
import { CodexKanbanRunner } from '../codexKanbanRunner'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'
import { KanbanWorktreeManager } from '../worktreeManager'
import type { KanbanRemoteAccess } from '../remoteAccess'
import type { KanbanExecutionPolicy } from '../../../types/kanban'

const execFileAsync = promisify(execFile)

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionEnabled: true,
  requireTrustedAccessForExecution: true,
  allowTailscaleAccess: true,
  requireLoopbackForExecution: false,
  disableExecutionWhenRemote: false,
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
  allowDangerFullAccess: false,
  allowApprovalNever: false,
  allowAcceptForSession: false,
  useThreadShellCommand: false,
  maxGlobalActiveRuns: 1,
  maxActiveRunsPerRepo: 1,
  maxActiveRunsPerTask: 1,
}

const access: KanbanRemoteAccess = {
  forwarded: false,
  loopback: true,
  tailscale: false,
  trusted: true,
  remoteAddress: '127.0.0.1',
  forwardedFor: '',
  reason: 'loopback',
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-runner-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-kanban-runner-repo-'))
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'initial'])
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const service = new KanbanTaskService({ storage, projectRoot, policy })
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const bridge: CodexBridgeRuntime = {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
      rpcCalls.push({ method, params })
      if (method === 'thread/start') return { threadId: 'thread_1' } as T
      if (method === 'turn/start') return { turnId: 'turn_1' } as T
      return {} as T
    },
    subscribeNotifications: vi.fn(() => () => {}),
    dispose: vi.fn(),
  }
  const runner = new CodexKanbanRunner({
    dataDir,
    projectRoot,
    storage,
    worktreeManager: new KanbanWorktreeManager({ dataDir, projectRoot }),
    bridge,
    auditLog: new KanbanAuditLog({ dataDir, projectRoot }),
  })
  return { service, storage, runner, rpcCalls }
}

describe('CodexKanbanRunner', () => {
  it('creates a managed worktree and starts a Codex turn through the bridge', async () => {
    const { service, storage, runner, rpcCalls } = await createHarness()
    const task = await service.createTask({ title: 'Runner task', acceptanceCriteria: [{ text: 'starts safely' }] })

    const result = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })
    const state = await storage.load()

    expect(result.run.state).toBe('running')
    expect(result.task.runState).toBe('running')
    expect(result.task.status).toBe('running')
    expect(result.run.worktreePath).toContain('/worktrees/')
    expect(state.runs[result.run.id]).toMatchObject({ id: result.run.id, threadId: 'thread_1', turnId: 'turn_1' })
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/start', 'turn/start'])
    expect(JSON.stringify(rpcCalls)).toContain('workspace-write')
    expect(JSON.stringify(rpcCalls)).not.toContain('thread/shellCommand')
  })

  it('interrupts a running turn and preserves the managed worktree', async () => {
    const { service, runner, rpcCalls } = await createHarness()
    const task = await service.createTask({ title: 'Interrupt task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    const result = await runner.interruptRun(started.run.id, { access, sessionId: 'session_1' })

    expect(result.run.state).toBe('cancelled')
    expect(result.task?.runState).toBe('cancelled')
    expect(rpcCalls.map((call) => call.method)).toContain('turn/interrupt')
  })
})
