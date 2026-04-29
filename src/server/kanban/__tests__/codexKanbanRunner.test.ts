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
import { FULL_ACCESS_KANBAN_RUN_PROFILE_ID, type KanbanExecutionPolicy, type KanbanProposal } from '../../../types/kanban'
import type { CodexBridgeNotification } from '../../codexAppServerBridge'

const execFileAsync = promisify(execFile)

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionMode: 'trusted_remote',
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
  accessContext: 'loopback',
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
  failThreadRead?: boolean
  policy?: KanbanExecutionPolicy
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
  const executionPolicy = options.policy ?? policy
  await storage.mutate((state) => {
    state.settings.kanbanConfig.executionMode = executionPolicy.executionMode
  })
  const service = new KanbanTaskService({ storage, projectRoot, policy: executionPolicy })
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
        if (options.failThreadRead) throw new Error('thread read failed')
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
    policy: executionPolicy,
    getExecutionPolicy: async () => await service.getExecutionPolicy(),
    proposalService,
    reviewPacketService,
    eventBus,
    queueLimits: options.queueLimits,
  })
  return { projectRoot, service, storage, runner, rpcCalls, notificationListeners, bridge, eventBus }
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
    expect(JSON.stringify(rpcCalls)).toContain('workspaceWrite')
    expect(rpcCalls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: expect.arrayContaining([result.run.worktreePath]),
      },
    })
    expect(JSON.stringify(rpcCalls)).not.toContain('thread/shellCommand')
  })

  it('uses the effective run profile snapshot when starting a Codex turn', async () => {
    const { service, storage, runner, rpcCalls } = await createHarness()
    await service.updateConfig({ defaultRunProfileId: 'workspace-coding-network' })
    const task = await service.createTask({
      title: 'Read-only profiled task',
      model: 'gpt-5.4',
      thinking: 'high',
      runProfileId: 'read-only-planning',
    })

    const result = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })
    const state = await storage.load()
    const turnStart = rpcCalls.find((call) => call.method === 'turn/start')

    expect(result.run.runProfileSnapshot).toMatchObject({
      id: 'read-only-planning',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      networkAccess: false,
    })
    expect(state.runs[result.run.id]).toMatchObject({
      runProfileSnapshot: result.run.runProfileSnapshot,
    })
    expect(turnStart?.params).toMatchObject({
      threadId: 'thread_1',
      cwd: result.run.worktreePath,
      input: [{ type: 'text', text: expect.stringContaining('Read-only profiled task') }],
      model: 'gpt-5.4',
      effort: 'high',
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'readOnly',
        networkAccess: false,
      },
    })
    expect(JSON.stringify(turnStart?.params)).not.toContain('sandboxMode')
    expect(JSON.stringify(turnStart?.params)).not.toContain('permissionProfile')
  })

  it('blocks danger-full-access run profiles unless policy explicitly allows them', async () => {
    const { service, runner, rpcCalls } = await createHarness()
    const task = await service.createTask({
      title: 'Danger profile task',
      runProfileId: FULL_ACCESS_KANBAN_RUN_PROFILE_ID,
    })

    await expect(runner.startTaskRun(task.id, { access, sessionId: 'session_1' }))
      .rejects
      .toThrow('danger-full-access')
    expect(rpcCalls.map((call) => call.method)).toEqual([])
  })

  it('allows danger-full-access run profiles behind the explicit policy toggle', async () => {
    const { service, runner, rpcCalls } = await createHarness({
      policy: { ...policy, allowDangerFullAccess: true },
    })
    const task = await service.createTask({
      title: 'Allowed danger profile task',
      runProfileId: FULL_ACCESS_KANBAN_RUN_PROFILE_ID,
    })

    const result = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

    expect(result.run.runProfileSnapshot.sandboxMode).toBe('danger-full-access')
    expect(rpcCalls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
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

  it('emits refresh events when a queued run is promoted', async () => {
    const { service, runner, eventBus } = await createHarness()
    const events: Array<{ type: string; payload: unknown }> = []
    const unsubscribe = eventBus.subscribe((event) => events.push(event))
    const firstTask = await service.createTask({ title: 'Active before promotion' })
    const secondTask = await service.createTask({ title: 'Promoted queued run' })
    const firstRun = await runner.startTaskRun(firstTask.id, { access, sessionId: 'session_1' })
    const secondRun = await runner.startTaskRun(secondTask.id, { access, sessionId: 'session_1' })

    await runner.completeRun(firstRun.run.id, { result: 'Finished active run' })
    unsubscribe()

    expect(secondRun.run.state).toBe('queued')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'task.updated',
      payload: { taskId: secondTask.id, runId: secondRun.run.id },
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'run.started',
      payload: { runId: secondRun.run.id, taskId: secondTask.id, state: 'running' },
    }))
  })

  it('fails queued runs instead of promoting them after execution is disabled', async () => {
    const { service, storage, runner, rpcCalls } = await createHarness()
    const firstTask = await service.createTask({ title: 'Active before disabled mode' })
    const secondTask = await service.createTask({ title: 'Queued after disabled mode' })
    const firstRun = await runner.startTaskRun(firstTask.id, { access, sessionId: 'session_1' })
    const secondRun = await runner.startTaskRun(secondTask.id, { access, sessionId: 'session_1' })
    const turnStartsBeforePromotion = rpcCalls.filter((call) => call.method === 'turn/start').length

    await service.updateConfig({ executionMode: 'disabled' })
    await runner.completeRun(firstRun.run.id, { result: 'Finished active run' })

    const state = await storage.load()
    expect(secondRun.run.state).toBe('queued')
    expect(state.runs[secondRun.run.id]).toMatchObject({
      state: 'failed',
      errorMessage: 'Kanban execution is disabled',
    })
    expect(state.tasks[secondTask.id]).toMatchObject({
      runState: 'failed',
      errorMessage: 'Kanban execution is disabled',
    })
    expect(rpcCalls.filter((call) => call.method === 'turn/start')).toHaveLength(turnStartsBeforePromotion)
  })

  it('does not promote archived queued tasks', async () => {
    const { service, storage, runner } = await createHarness()
    const firstTask = await service.createTask({ title: 'Active before archived queued task' })
    const secondTask = await service.createTask({ title: 'Archived queued task' })
    const firstRun = await runner.startTaskRun(firstTask.id, { access, sessionId: 'session_1' })
    const secondRun = await runner.startTaskRun(secondTask.id, { access, sessionId: 'session_1' })
    const queuedTask = (await storage.load()).tasks[secondTask.id]
    if (!queuedTask) throw new Error('Expected queued task')

    await service.archiveTask(queuedTask.id, { version: queuedTask.version })
    await runner.completeRun(firstRun.run.id, { result: 'Finished active run' })

    const state = await storage.load()
    expect(secondRun.run.state).toBe('queued')
    expect(state.runs[secondRun.run.id]).toMatchObject({
      state: 'failed',
      errorMessage: 'Cannot start a Kanban run for an archived task',
    })
    expect(state.tasks[secondTask.id]).toMatchObject({
      archived: true,
      runState: 'failed',
    })
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

  it('logs notification completion failures without failing the listener', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { service, storage, runner, notificationListeners } = await createHarness({ failThreadRead: true })
      const task = await service.createTask({ title: 'Notification failure task' })
      const started = await runner.startTaskRun(task.id, { access, sessionId: 'session_1' })

      await expect(Promise.resolve(notificationListeners[0]!({
        method: 'turn/completed',
        params: { threadId: 'thread_1', turnId: 'turn_1' },
        atIso: new Date().toISOString(),
      }))).resolves.toBeUndefined()

      const state = await storage.load()
      expect(state.runs[started.run.id]).toMatchObject({ state: 'running' })
      expect(consoleWarn).toHaveBeenCalledWith(
        'Kanban turn completion notification failed:',
        expect.objectContaining({ message: 'thread read failed' }),
      )
    } finally {
      consoleWarn.mockRestore()
    }
  })
})
