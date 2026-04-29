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
import type { KanbanTaskQueueLimits } from '../taskQueue'
import { KanbanWorktreeManager } from '../worktreeManager'
import type { KanbanRemoteAccess } from '../remoteAccess'
import type { KanbanExecutionPolicy, KanbanProposal } from '../../../types/kanban'
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

type HarnessOptions = {
  readThreadResponse?: unknown
  reviewPacketService?: Pick<KanbanReviewPacketService, 'generateForTask'>
  proposalService?: Pick<KanbanProposalService, 'createProposalsFromMarkers'>
  failThreadStart?: boolean
  queueLimits?: Partial<KanbanTaskQueueLimits>
}

async function createHarness(options: HarnessOptions = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-runner-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-kanban-runner-repo-'))
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'initial'])
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const service = new KanbanTaskService({ storage, projectRoot, policy })
  const eventBus = new KanbanEventBus()
  const proposalService = options.proposalService ?? new KanbanProposalService({ storage, taskService: service, eventBus })
  const reviewPacketService = options.reviewPacketService ?? new KanbanReviewPacketService({ storage })
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const notificationListeners: Array<(notification: CodexBridgeNotification) => void> = []
  let threadStartCount = 0
  let turnStartCount = 0
  const bridge: CodexBridgeRuntime = {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
      rpcCalls.push({ method, params })
      if (method === 'thread/start') {
        if (options.failThreadStart) throw new Error('thread start failed')
        threadStartCount += 1
        return { threadId: `thread_${threadStartCount}` } as T
      }
      if (method === 'turn/start') {
        turnStartCount += 1
        return { turnId: `turn_${turnStartCount}` } as T
      }
      if (method === 'thread/read') {
        return (options.readThreadResponse ?? {
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
        }) as T
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
    queueLimits: options.queueLimits,
  })
  return { projectRoot, service, storage, runner, rpcCalls, notificationListeners, bridge }
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

  it('preserves the managed worktree when Codex startup fails', async () => {
    const { projectRoot, service, storage, runner } = await createHarness({ failThreadStart: true })
    const task = await service.createTask({ title: 'Startup failure task' })

    await expect(runner.startTaskRun(task.id, { access, sessionId: 'session_1' }))
      .rejects
      .toThrow('thread start failed')

    const state = await storage.load()
    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])
    const branches = await runGit(projectRoot, ['branch', '--list', 'codexui/task/*'])
    const failedRun = state.runs[Object.keys(state.runs)[0] ?? '']
    expect(failedRun).toMatchObject({ state: 'failed' })
    expect(state.tasks[task.id]).toMatchObject({ runState: 'failed' })
    expect(state.tasks[task.id]?.worktreePath).toContain('/worktrees/')
    expect(state.tasks[task.id]?.branchName).toContain('startup-failure-task')
    expect(worktreeList).toContain(state.tasks[task.id]?.worktreePath)
    expect(branches).toContain(state.tasks[task.id]?.branchName)
    await expect(runner.readRunEvents(Object.keys(state.runs)[0] ?? '')).resolves.toContain('manual cleanup')
  })

  it('refuses to start runs for archived tasks', async () => {
    const { service, runner } = await createHarness()
    const task = await service.createTask({ title: 'Archived run task' })
    await service.archiveTask(task.id, { version: task.version })

    await expect(runner.startTaskRun(task.id, { access, sessionId: 'session_1' }))
      .rejects
      .toThrow('Cannot start a Kanban run for an archived task')
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

  it('rejects interrupt requests for terminal runs', async () => {
    const { service, runner } = await createHarness()
    const task = await service.createTask({ title: 'Already completed task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })
    await runner.completeRun(started.run.id, { result: 'Already complete' })

    await expect(runner.interruptRun(started.run.id, { access, sessionId: 'session_1' }))
      .rejects
      .toThrow('Cannot interrupt inactive Kanban run')
  })

  it('removes interrupted queued runs so later queue promotion can continue', async () => {
    const { service, storage, runner } = await createHarness()
    const firstTask = await service.createTask({ title: 'Active before queued interrupt' })
    const secondTask = await service.createTask({ title: 'Queued interrupt target' })
    const thirdTask = await service.createTask({ title: 'Runs after queued interrupt' })
    const firstRun = await runner.startTaskRun(firstTask.id, { access, sessionId: 'session_1' })
    const secondRun = await runner.startTaskRun(secondTask.id, { access, sessionId: 'session_1' })

    expect(secondRun.run.state).toBe('queued')
    await runner.interruptRun(secondRun.run.id, { access, sessionId: 'session_1' })
    await runner.completeRun(firstRun.run.id, { result: 'Finished active run' })
    const thirdRun = await runner.startTaskRun(thirdTask.id, { access, sessionId: 'session_1' })

    const state = await storage.load()
    expect(state.runs[secondRun.run.id]).toMatchObject({ state: 'cancelled' })
    expect(thirdRun.run.state).toBe('running')
    expect(state.tasks[thirdTask.id]).toMatchObject({ status: 'running', runState: 'running' })
  })

  it('applies configured queue limits when starting runs', async () => {
    const { service, storage, runner } = await createHarness({
      queueLimits: {
        maxGlobalActiveRuns: 2,
        maxActiveRunsPerRepo: 2,
        maxActiveRunsPerTask: 1,
      },
    })
    const firstTask = await service.createTask({ title: 'First policy-capacity task' })
    const secondTask = await service.createTask({ title: 'Second policy-capacity task' })

    const firstRun = await runner.startTaskRun(firstTask.id, { access, sessionId: 'session_1' })
    const secondRun = await runner.startTaskRun(secondTask.id, { access, sessionId: 'session_1' })

    const state = await storage.load()
    expect(firstRun.run.state).toBe('running')
    expect(secondRun.run.state).toBe('running')
    expect(state.tasks[firstTask.id]).toMatchObject({ runState: 'running' })
    expect(state.tasks[secondTask.id]).toMatchObject({ runState: 'running' })
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

  it('manual failure completion clears a stale review packet from a prior run', async () => {
    const { service, storage, runner } = await createHarness()
    const task = await service.createTask({ title: 'Failed rerun stale packet task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })
    await storage.mutate((state) => {
      state.tasks[task.id] = {
        ...state.tasks[task.id]!,
        reviewPacketId: 'review_packet_stale',
      }
      state.reviewPackets.review_packet_stale = { id: 'review_packet_stale' }
    })

    const result = await runner.completeRun(started.run.id, {
      result: '',
      error: 'rerun failed',
    })
    const state = await storage.load()

    expect(result.reviewPacketId).toBe('')
    expect(state.tasks[task.id]!.reviewPacketId).toBe('')
    expect(state.tasks[task.id]!.runState).toBe('failed')
  })

  it('does not duplicate completion side effects across manual and notification entrypoints', async () => {
    let releaseProposal: () => void = () => {}
    const proposalGate = new Promise<void>((resolve) => {
      releaseProposal = resolve
    })
    const createProposalsFromMarkers = vi.fn(async () => {
      await proposalGate
      return {
        cleanText: 'Locked result text',
        proposals: [{ id: 'proposal_locked' } as KanbanProposal],
      }
    })
    const generateForTask = vi.fn(async (taskId: string) => ({
      packet: {
        id: 'review_packet_locked',
        taskId,
        runId: '',
        packetHash: 'hash',
        generatedAtIso: new Date().toISOString(),
        baseCommit: '',
        headCommit: '',
        rawDiffPatch: '',
        summary: { fileCount: 0, addedLineCount: 0, removedLineCount: 0 },
        testResults: [],
        unresolvedProposalIds: ['proposal_locked'],
      },
      task: { id: taskId } as Awaited<ReturnType<KanbanReviewPacketService['generateForTask']>>['task'],
    }))
    const { service, storage, runner, notificationListeners } = await createHarness({
      proposalService: { createProposalsFromMarkers },
      reviewPacketService: { generateForTask },
      readThreadResponse: {
        thread: {
          turns: [
            { id: 'turn_1', items: [{ type: 'agentMessage', text: 'Notification result text' }] },
          ],
        },
      },
    })
    const task = await service.createTask({ title: 'Idempotent completion task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    const manual = runner.completeRun(started.run.id, { result: 'Manual result text' })
    const notification = Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread_1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    releaseProposal()
    await Promise.all([manual, notification])

    const state = await storage.load()
    expect(createProposalsFromMarkers).toHaveBeenCalledOnce()
    expect(generateForTask).toHaveBeenCalledOnce()
    expect(state.tasks[task.id]!.proposalIds).toEqual(['proposal_locked'])
  })

  it('records review packet generation errors and still promotes queued runs', async () => {
    const generateForTask = vi.fn(async () => {
      throw new Error('review packet unavailable')
    })
    const { service, storage, runner } = await createHarness({
      reviewPacketService: { generateForTask },
    })
    const firstTask = await service.createTask({ title: 'First queued task' })
    const secondTask = await service.createTask({ title: 'Second queued task' })
    const firstRun = await runner.startTaskRun(firstTask.id, { access, sessionId: 'session_1' })
    const secondRun = await runner.startTaskRun(secondTask.id, { access, sessionId: 'session_1' })
    await storage.mutate((state) => {
      state.tasks[firstTask.id] = {
        ...state.tasks[firstTask.id]!,
        reviewPacketId: 'review_packet_stale',
      }
      state.reviewPackets.review_packet_stale = { id: 'review_packet_stale' }
    })

    expect(secondRun.run.state).toBe('queued')
    await runner.completeRun(firstRun.run.id, { result: 'Completed first task' })

    const state = await storage.load()
    expect(state.runs[firstRun.run.id]).toMatchObject({ state: 'succeeded', errorMessage: 'Review packet generation failed: review packet unavailable' })
    expect(state.tasks[firstTask.id]).toMatchObject({
      status: 'review',
      runState: 'succeeded',
      reviewPacketId: '',
      errorMessage: 'Review packet generation failed: review packet unavailable',
    })
    expect(state.runs[secondRun.run.id]).toMatchObject({ state: 'running', threadId: 'thread_2', turnId: 'turn_2' })
    expect(state.tasks[secondTask.id]).toMatchObject({ status: 'running', runState: 'running' })
    await expect(runner.readRunEvents(firstRun.run.id)).resolves.toContain('review_packet.failed')
  })

  it('uses snake_case completion ids and extracts text from the completed turn only', async () => {
    const { service, storage, runner, notificationListeners } = await createHarness({
      readThreadResponse: {
        thread: {
          turns: [
            { id: 'turn_1', items: [{ type: 'agentMessage', text: 'Correct completed turn text' }] },
            { id: 'turn_2', items: [{ type: 'agentMessage', text: 'Wrong latest turn text' }] },
          ],
        },
      },
    })
    const task = await service.createTask({ title: 'Snake notification task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { thread_id: 'thread_1', turn_id: 'turn_1' },
      atIso: new Date().toISOString(),
    }))

    const state = await storage.load()
    expect(state.runs[started.run.id]).toMatchObject({ state: 'succeeded' })
    expect(state.tasks[task.id]!.result).toBe('Correct completed turn text')
    expect(state.tasks[task.id]!.result).not.toContain('Wrong latest')
  })

  it('does not fall back to another turn when the completed turn has no assistant text', async () => {
    const { service, storage, runner, notificationListeners } = await createHarness({
      readThreadResponse: {
        thread: {
          turns: [
            { id: 'turn_1', items: [{ type: 'userMessage', content: [{ type: 'text', text: 'No assistant here' }] }] },
            { id: 'turn_2', items: [{ type: 'agentMessage', text: 'Wrong latest assistant text' }] },
          ],
        },
      },
    })
    const task = await service.createTask({ title: 'No fallback notification task' })
    const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread_1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))

    const state = await storage.load()
    expect(state.runs[started.run.id]).toMatchObject({ state: 'running' })
    expect(state.tasks[task.id]!.result).toBe('')
    expect(state.tasks[task.id]!.status).toBe('running')
  })
})
