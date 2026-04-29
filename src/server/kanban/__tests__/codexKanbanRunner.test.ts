import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { CodexBridgeRuntime } from '../../codexAppServerBridge'
import { KanbanAuditLog } from '../auditLog'
import { CodexKanbanRunner } from '../codexKanbanRunner'
import { KanbanEventBus } from '../eventBus'
import { KanbanProposalService } from '../proposalService'
import { KanbanReviewPacketService } from '../reviewPacketService'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'
import { KanbanWorktreeManager } from '../worktreeManager'
import type { KanbanRemoteAccess } from '../remoteAccess'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import type { CodexBridgeNotification } from '../../codexAppServerBridge'

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
  const eventBus = new KanbanEventBus()
  const proposalService = new KanbanProposalService({ storage, taskService: service, eventBus })
  const reviewPacketService = new KanbanReviewPacketService({ storage })
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const notificationListeners: Array<(notification: CodexBridgeNotification) => void> = []
  const bridge: CodexBridgeRuntime = {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
      rpcCalls.push({ method, params })
      if (method === 'thread/start') return { threadId: 'thread_1' } as T
      if (method === 'turn/start') return { turnId: 'turn_1' } as T
      if (method === 'thread/read') {
        return {
          thread: {
            turns: [
              {
                id: 'turn_1',
                items: [
                  {
                    type: 'agentMessage',
                    text: `Normal result text.

\`\`\`kanban:create
{"title":"Follow-up marker task","priority":"high"}
\`\`\``,
                  },
                ],
              },
            ],
          },
        } as T
      }
      return {} as T
    },
    subscribeNotifications: vi.fn((listener) => {
      notificationListeners.push(listener)
      return () => {}
    }),
    dispose: vi.fn(),
  }
  const runner = new CodexKanbanRunner({
    dataDir,
    projectRoot,
    storage,
    worktreeManager: new KanbanWorktreeManager({ dataDir, projectRoot }),
    bridge,
    auditLog: new KanbanAuditLog({ dataDir, projectRoot }),
    proposalService,
    reviewPacketService,
  })
  return { service, storage, runner, rpcCalls, notificationListeners, bridge }
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

  it('completes a matching active run from a turn completion notification', async () => {
    const { service, storage, runner, rpcCalls, notificationListeners, bridge } = await createHarness()
    const task = await service.createTask({ title: 'Completion task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    expect(bridge.subscribeNotifications).toHaveBeenCalledOnce()
    expect(notificationListeners).toHaveLength(1)
    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread_1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread_1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))

    const state = await storage.load()
    const completedRun = state.runs[started.run.id]
    const completedTask = state.tasks[task.id]!

    expect(completedRun).toMatchObject({ id: started.run.id, state: 'succeeded' })
    expect(completedTask.status).toBe('review')
    expect(completedTask.runState).toBe('succeeded')
    expect(completedTask.result).toContain('Normal result text.')
    expect(completedTask.result).not.toContain('kanban:create')
    expect(completedTask.resultAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(completedTask.proposalIds).toHaveLength(1)
    expect(completedTask.reviewPacketId).toMatch(/^review_packet_/u)
    expect(Object.values(state.proposals)).toHaveLength(1)
    expect(Object.values(state.reviewPackets)).toHaveLength(1)
    expect(rpcCalls).toContainEqual({
      method: 'thread/read',
      params: { threadId: 'thread_1', includeTurns: true },
    })
    await expect(runner.readRunEvents(started.run.id)).resolves.toContain('"type":"run.completed"')
  })

  it('manual completion with an error fails the run without proposals or review packets', async () => {
    const { service, storage, runner } = await createHarness()
    const task = await service.createTask({ title: 'Manual failure task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    const result = await runner.completeRun(started.run.id, {
      result: 'Manual failure text',
      error: 'manual completion failed',
    })
    const state = await storage.load()
    const failedTask = state.tasks[task.id]!

    expect(result.run.state).toBe('failed')
    expect(result.proposalIds).toEqual([])
    expect(result.reviewPacketId).toBe('')
    expect(failedTask.status).toBe('rework')
    expect(failedTask.runState).toBe('failed')
    expect(failedTask.result).toBe('Manual failure text')
    expect(failedTask.errorMessage).toBe('manual completion failed')
    expect(Object.values(state.proposals)).toHaveLength(0)
    expect(Object.values(state.reviewPackets)).toHaveLength(0)
  })
})
