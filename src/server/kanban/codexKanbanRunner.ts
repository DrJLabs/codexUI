import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { KanbanActor, KanbanRun, KanbanTask, StartKanbanRunResponse, InterruptKanbanRunResponse } from '../../types/kanban'
import type { KanbanAuditSink } from './auditLog'
import { createKanbanCodexBridgeAdapter, type KanbanCodexBridgeAdapter } from './codexBridgeAdapter'
import type { KanbanEventBus } from './eventBus'
import { createKanbanId } from './ids'
import { resolveProjectRunDir } from './paths'
import type { KanbanProposalService } from './proposalService'
import type { KanbanRemoteAccess } from './remoteAccess'
import type { KanbanReviewPacketService } from './reviewPacketService'
import type { KanbanStateFileV1 } from './migrations'
import { KanbanStorage } from './storage'
import { KanbanTaskQueue } from './taskQueue'
import { KanbanWorktreeManager } from './worktreeManager'
import type { CodexBridgeRuntime } from '../codexAppServerBridge'

export type CodexKanbanRunnerOptions = {
  dataDir: string
  projectRoot: string
  storage: KanbanStorage
  worktreeManager: KanbanWorktreeManager
  bridge: CodexBridgeRuntime
  auditLog: KanbanAuditSink
  proposalService?: Pick<KanbanProposalService, 'createProposalsFromMarkers'>
  reviewPacketService?: Pick<KanbanReviewPacketService, 'generateForTask'>
  eventBus?: KanbanEventBus
}

export type KanbanRunActorContext = {
  access: KanbanRemoteAccess
  sessionId: string
}

export type CompleteKanbanRunInput = {
  result: string
  error?: string
}

export type CompleteKanbanRunResponse = {
  run: KanbanRun
  task: KanbanTask | null
  proposalIds: string[]
  reviewPacketId: string
}

export class CodexKanbanRunner {
  private readonly dataDir: string
  private readonly projectRoot: string
  private readonly storage: KanbanStorage
  private readonly worktreeManager: KanbanWorktreeManager
  private readonly bridge: KanbanCodexBridgeAdapter
  private readonly auditLog: KanbanAuditSink
  private readonly proposalService?: Pick<KanbanProposalService, 'createProposalsFromMarkers'>
  private readonly reviewPacketService?: Pick<KanbanReviewPacketService, 'generateForTask'>
  private readonly eventBus?: KanbanEventBus
  private readonly queue = new KanbanTaskQueue()
  private readonly completionLocks = new Map<string, Promise<void>>()

  constructor(options: CodexKanbanRunnerOptions) {
    this.dataDir = options.dataDir
    this.projectRoot = options.projectRoot
    this.storage = options.storage
    this.worktreeManager = options.worktreeManager
    this.bridge = createKanbanCodexBridgeAdapter(options.bridge)
    this.auditLog = options.auditLog
    this.proposalService = options.proposalService
    this.reviewPacketService = options.reviewPacketService
    this.eventBus = options.eventBus
    this.bridge.subscribeNotifications((notification) => this.handleBridgeNotification(notification))
  }

  async startTaskRun(taskId: string, actor: KanbanRunActorContext): Promise<StartKanbanRunResponse> {
    const task = await this.readTask(taskId)
    const run = this.createRun(task)
    await this.auditLog.append({
      eventType: 'run.queued',
      actor: createAuditActor(actor),
      task: { taskId },
      repo: { projectRoot: this.projectRoot },
      codex: { runId: run.id },
      policy: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', networkAccess: false },
    })

    const queueResult = this.queue.enqueue({ runId: run.id, taskId, repoRoot: this.projectRoot })
    if (queueResult.state === 'queued') {
      const queuedTask = await this.persistRun(run, { runState: 'queued' })
      return { run, task: queuedTask }
    }

    try {
      return await this.startActiveRun(run, task)
    } catch (error) {
      await this.releaseRunAndStartPromoted(run.id)
      const message = error instanceof Error ? error.message : 'Kanban run failed to start'
      const failedRun = { ...run, state: 'failed' as const, errorMessage: message, updatedAtIso: new Date().toISOString() }
      await this.writeRunLog(failedRun, `Run failed: ${message}\n`).catch(() => {})
      const failedTask = await this.persistRun(failedRun, { runState: 'failed', errorMessage: message })
      return Promise.reject(Object.assign(new Error(message), { run: failedRun, task: failedTask }))
    }
  }

  async interruptRun(runId: string, actor: KanbanRunActorContext): Promise<InterruptKanbanRunResponse> {
    const run = await this.readRun(runId)
    await this.auditLog.append({
      eventType: 'run.interrupt_requested',
      actor: createAuditActor(actor),
      task: { taskId: run.taskId },
      repo: { projectRoot: this.projectRoot },
      codex: { runId, threadId: run.threadId, turnId: run.turnId },
      policy: { interruptOnly: true },
    })
    if (run.turnId) {
      await this.bridge.rpc('turn/interrupt', { threadId: run.threadId, turnId: run.turnId })
    }
    const cancelledRun = { ...run, state: 'cancelled' as const, updatedAtIso: new Date().toISOString() }
    await this.writeRunLog(cancelledRun, 'Run interrupted by local user.\n')
    await this.writeRunEvent(cancelledRun, { type: 'run.cancelled' })
    const task = await this.persistRun(cancelledRun, { status: 'cancelled', runState: 'cancelled' })
    if (run.state === 'queued') {
      await this.cancelRunAndStartPromoted(runId)
    } else {
      await this.releaseRunAndStartPromoted(runId)
    }
    return { run: cancelledRun, task }
  }

  async getRun(runId: string): Promise<KanbanRun> {
    return await this.readRun(runId)
  }

  async completeRun(runId: string, input: CompleteKanbanRunInput): Promise<CompleteKanbanRunResponse> {
    return await this.withCompletionLock(runId, async () => {
      const run = await this.readRun(runId)
      return await this.completeRunFromText(run, input)
    })
  }

  async readRunLogs(runId: string): Promise<string> {
    const run = await this.readRun(runId)
    return await readOptionalText(run.logPath)
  }

  async readRunEvents(runId: string): Promise<string> {
    const run = await this.readRun(runId)
    return await readOptionalText(run.eventsPath)
  }

  private createRun(task: KanbanTask): KanbanRun {
    const runId = createKanbanId('run')
    const runDir = resolveProjectRunDir(this.dataDir, this.projectRoot, runId)
    const now = new Date().toISOString()
    return {
      id: runId,
      taskId: task.id,
      state: 'queued',
      projectRoot: this.projectRoot,
      worktreePath: '',
      branchName: '',
      threadId: task.codexThreadId,
      turnId: '',
      logPath: `${runDir}/logs.txt`,
      eventsPath: `${runDir}/events.jsonl`,
      errorMessage: '',
      createdAtIso: now,
      updatedAtIso: now,
    }
  }

  private async handleBridgeNotification(notification: { method: string; params: unknown }): Promise<void> {
    if (notification.method !== 'turn/completed') return
    try {
      const threadId = extractThreadId(notification.params)
      const turnId = extractTurnId(notification.params)
      if (!threadId || !turnId) return
      const run = await this.findActiveRunForTurn(threadId, turnId)
      if (!run) return
      const response = await this.bridge.rpc('thread/read', { threadId, includeTurns: true })
      const result = extractLatestAssistantMessageText(response, turnId)
      if (!result) return
      await this.completeRun(run.id, { result })
    } catch {
      // Completion notifications are best-effort; the manual completion route remains available.
    }
  }

  private async findActiveRunForTurn(threadId: string, turnId: string): Promise<KanbanRun | null> {
    const state = await this.storage.load()
    for (const value of Object.values(state.runs)) {
      if (!isKanbanRun(value)) continue
      if (value.threadId !== threadId || value.turnId !== turnId) continue
      if (!isActiveRunState(value.state)) continue
      return value
    }
    return null
  }

  private async completeRunFromText(run: KanbanRun, input: CompleteKanbanRunInput): Promise<CompleteKanbanRunResponse> {
    const currentRun = await this.readRun(run.id)
    if (!isActiveRunState(currentRun.state)) {
      return await this.readCompletedRunResponse(currentRun)
    }
    try {
      if (input.error?.trim()) {
        return await this.completeFailedRun(currentRun, input)
      }
      return await this.completeSucceededRun(currentRun, input.result)
    } catch (error) {
      return await this.completeFailedRun(currentRun, {
        result: input.result,
        error: error instanceof Error ? error.message : 'Kanban run completion failed',
      })
    } finally {
      await this.releaseRunAndStartPromoted(currentRun.id)
    }
  }

  private async completeSucceededRun(run: KanbanRun, resultText: string): Promise<CompleteKanbanRunResponse> {
    if (!this.proposalService) {
      throw new Error('Kanban proposal service is required to complete a run')
    }
    if (!this.reviewPacketService) {
      throw new Error('Kanban review packet service is required to complete a run')
    }
    const proposalResult = await this.proposalService.createProposalsFromMarkers({
      text: resultText,
      sourceRunId: run.id,
      sourceThreadId: run.threadId,
      proposedBy: run.threadId ? `codex:thread:${run.threadId}` as KanbanActor : 'codex:auto',
    })
    const proposalIds = proposalResult.proposals.map((proposal) => proposal.id)
    const now = new Date().toISOString()
    let completedRun = { ...run, state: 'succeeded' as const, errorMessage: '', updatedAtIso: now }
    await this.storage.mutate((state: KanbanStateFileV1) => {
      const task = state.tasks[run.taskId]
      if (!task) throw new Error(`Kanban task not found: ${run.taskId}`)
      state.runs[run.id] = completedRun
      state.tasks[task.id] = {
        ...task,
        status: 'review',
        runState: 'succeeded',
        result: proposalResult.cleanText,
        resultAtIso: now,
        errorMessage: '',
        reviewPacketId: '',
        proposalIds: mergeUnique(task.proposalIds, proposalIds),
        updatedAtIso: now,
        version: task.version + 1,
      }
    })
    let completedTask = await this.readTask(run.taskId)
    let reviewPacketId = ''
    let reviewPacketError = ''
    try {
      const reviewResult = await this.reviewPacketService.generateForTask(run.taskId)
      completedTask = reviewResult.task
      reviewPacketId = reviewResult.packet.id
    } catch (error) {
      reviewPacketError = `Review packet generation failed: ${error instanceof Error ? error.message : 'unknown error'}`
      completedRun = { ...completedRun, errorMessage: reviewPacketError, updatedAtIso: new Date().toISOString() }
      await this.storage.mutate((state: KanbanStateFileV1) => {
        const task = state.tasks[run.taskId]
        if (!task) throw new Error(`Kanban task not found: ${run.taskId}`)
        state.runs[run.id] = completedRun
        completedTask = {
          ...task,
          errorMessage: reviewPacketError,
          reviewPacketId: '',
          updatedAtIso: completedRun.updatedAtIso,
          version: task.version + 1,
        }
        state.tasks[task.id] = completedTask
      })
      await this.writeRunEvent(completedRun, { type: 'review_packet.failed', error: reviewPacketError })
    }
    await this.writeRunLog(
      completedRun,
      reviewPacketError ? `Run completed successfully. ${reviewPacketError}\n` : 'Run completed successfully.\n',
    )
    await this.writeRunEvent(completedRun, {
      type: 'run.completed',
      result: 'succeeded',
      proposalIds,
      reviewPacketId,
      reviewPacketError,
    })
    this.eventBus?.emit({
      type: 'task.updated',
      payload: { taskId: completedTask.id, runId: run.id, proposalIds, reviewPacketId, reviewPacketError },
    })
    this.eventBus?.emit({
      type: 'run.completed',
      payload: { runId: run.id, taskId: run.taskId, state: 'succeeded', proposalIds, reviewPacketId, reviewPacketError },
    })
    return { run: completedRun, task: completedTask, proposalIds, reviewPacketId }
  }

  private async completeFailedRun(run: KanbanRun, input: CompleteKanbanRunInput): Promise<CompleteKanbanRunResponse> {
    const errorMessage = input.error?.trim() || 'Kanban run failed'
    const now = new Date().toISOString()
    const failedRun = { ...run, state: 'failed' as const, errorMessage, updatedAtIso: now }
    let failedTask: KanbanTask | null = null
    await this.storage.mutate((state: KanbanStateFileV1) => {
      const task = state.tasks[run.taskId]
      if (!task) throw new Error(`Kanban task not found: ${run.taskId}`)
      state.runs[run.id] = failedRun
      failedTask = {
        ...task,
        status: 'rework',
        runState: 'failed',
        result: input.result.trim(),
        resultAtIso: now,
        errorMessage,
        updatedAtIso: now,
        version: task.version + 1,
      }
      state.tasks[task.id] = failedTask
    })
    await this.writeRunLog(failedRun, `Run failed: ${errorMessage}\n`)
    await this.writeRunEvent(failedRun, { type: 'run.completed', result: 'failed', error: errorMessage })
    this.eventBus?.emit({ type: 'task.updated', payload: { taskId: run.taskId, runId: run.id } })
    this.eventBus?.emit({ type: 'run.completed', payload: { runId: run.id, taskId: run.taskId, state: 'failed', error: errorMessage } })
    return { run: failedRun, task: failedTask, proposalIds: [], reviewPacketId: '' }
  }

  private async startActiveRun(run: KanbanRun, task: KanbanTask): Promise<StartKanbanRunResponse> {
    await this.persistRun(run, { runState: 'preparing_worktree' })
    const worktree = await this.worktreeManager.createManagedWorktree({
      taskId: task.id,
      taskTitle: task.title,
      runId: run.id,
      baseBranch: task.baseBranch || undefined,
    })
    const preparingRun = {
      ...run,
      state: 'starting_codex' as const,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      updatedAtIso: new Date().toISOString(),
    }
    await this.writeRunEvent(preparingRun, { type: 'worktree.created', worktreePath: worktree.worktreePath, branchName: worktree.branchName })
    await this.persistRun(preparingRun, { runState: 'starting_codex', worktreePath: worktree.worktreePath, branchName: worktree.branchName })

    const threadId = await this.startOrResumeThread(task, preparingRun)
    const turnId = await this.startTurn(task, { ...preparingRun, threadId })
    const runningRun = {
      ...preparingRun,
      state: 'running' as const,
      threadId,
      turnId,
      updatedAtIso: new Date().toISOString(),
    }
    await this.writeRunLog(runningRun, `Started Codex turn ${turnId || '(unknown turn)'} in ${worktree.worktreePath}\n`)
    await this.writeRunEvent(runningRun, { type: 'run.started', threadId, turnId })
    const runningTask = await this.persistRun(runningRun, {
      status: 'running',
      runState: 'running',
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      codexThreadId: threadId,
    })
    return { run: runningRun, task: runningTask }
  }

  private async releaseRunAndStartPromoted(runId: string): Promise<void> {
    const promoted = this.queue.complete(runId)
    for (const item of promoted) {
      await this.startPromotedRun(item.runId, item.taskId).catch(async () => {
        await this.releaseRunAndStartPromoted(item.runId)
      })
    }
  }

  private async cancelRunAndStartPromoted(runId: string): Promise<void> {
    const promoted = this.queue.cancel(runId)
    for (const item of promoted) {
      await this.startPromotedRun(item.runId, item.taskId).catch(async () => {
        await this.releaseRunAndStartPromoted(item.runId)
      })
    }
  }

  private async startPromotedRun(runId: string, taskId: string): Promise<void> {
    const run = await this.readRun(runId)
    if (run.state !== 'queued') {
      await this.releaseRunAndStartPromoted(run.id)
      return
    }
    const task = await this.readTask(taskId)
    try {
      await this.startActiveRun(run, task)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kanban run failed to start'
      const failedRun = { ...run, state: 'failed' as const, errorMessage: message, updatedAtIso: new Date().toISOString() }
      await this.writeRunLog(failedRun, `Run failed: ${message}\n`).catch(() => {})
      await this.persistRun(failedRun, { runState: 'failed', errorMessage: message })
      await this.releaseRunAndStartPromoted(run.id)
    }
  }

  private async readCompletedRunResponse(run: KanbanRun): Promise<CompleteKanbanRunResponse> {
    const task = await this.readTask(run.taskId).catch(() => null)
    return {
      run,
      task,
      proposalIds: task?.proposalIds ?? [],
      reviewPacketId: task?.reviewPacketId ?? '',
    }
  }

  private async withCompletionLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.completionLocks.get(runId) ?? Promise.resolve()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const next = previous.catch(() => {}).then(() => gate)
    this.completionLocks.set(runId, next)
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.completionLocks.get(runId) === next) {
        this.completionLocks.delete(runId)
      }
    }
  }

  private async readTask(taskId: string): Promise<KanbanTask> {
    const state = await this.storage.load()
    const task = state.tasks[taskId]
    if (!task) throw new Error(`Kanban task not found: ${taskId}`)
    return task
  }

  private async readRun(runId: string): Promise<KanbanRun> {
    const state = await this.storage.load()
    const run = state.runs[runId]
    if (!isKanbanRun(run)) throw new Error(`Kanban run not found: ${runId}`)
    return run
  }

  private async persistRun(
    run: KanbanRun,
    taskPatch: Partial<Pick<KanbanTask, 'status' | 'runState' | 'worktreePath' | 'branchName' | 'codexThreadId' | 'errorMessage'>>,
  ): Promise<KanbanTask> {
    let persistedTask: KanbanTask | null = null
    await this.storage.mutate((state: KanbanStateFileV1) => {
      const task = state.tasks[run.taskId]
      if (!task) throw new Error(`Kanban task not found: ${run.taskId}`)
      state.runs[run.id] = run
      const nextRunIds = task.runIds.includes(run.id) ? task.runIds : [...task.runIds, run.id]
      persistedTask = {
        ...task,
        ...taskPatch,
        currentRunId: run.id,
        runIds: nextRunIds,
        updatedAtIso: new Date().toISOString(),
        version: task.version + 1,
      }
      state.tasks[task.id] = persistedTask
    })
    if (!persistedTask) throw new Error('Kanban task run state did not persist')
    return persistedTask
  }

  private async startOrResumeThread(task: KanbanTask, run: KanbanRun): Promise<string> {
    if (task.codexThreadId) {
      const resumed = await this.bridge.rpc<Record<string, unknown>>('thread/resume', { threadId: task.codexThreadId })
      return readString(resumed.threadId) || readString(resumed.id) || task.codexThreadId
    }
    const started = await this.bridge.rpc<Record<string, unknown>>('thread/start', {
      cwd: run.worktreePath,
      title: task.title,
    })
    return readString(started.threadId) || readString(started.id)
  }

  private async startTurn(task: KanbanTask, run: KanbanRun): Promise<string> {
    const prompt = buildTaskPrompt(task)
    const started = await this.bridge.rpc<Record<string, unknown>>('turn/start', {
      threadId: run.threadId,
      cwd: run.worktreePath,
      prompt,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      networkAccess: false,
    })
    return readString(started.turnId) || readString(started.id)
  }

  private async writeRunLog(run: KanbanRun, line: string): Promise<void> {
    await mkdir(dirname(run.logPath), { recursive: true })
    await appendFile(run.logPath, line, 'utf8')
  }

  private async writeRunEvent(run: KanbanRun, event: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(run.eventsPath), { recursive: true })
    await appendFile(run.eventsPath, `${JSON.stringify({ ...event, atIso: new Date().toISOString(), runId: run.id })}\n`, 'utf8')
  }
}

function buildTaskPrompt(task: KanbanTask): string {
  const criteria = task.acceptanceCriteria.map((criterion) => `- [${criterion.checked ? 'x' : ' '}] ${criterion.text}`).join('\n')
  return [
    `Implement Kanban task: ${task.title}`,
    task.description ? `\nDescription:\n${task.description}` : '',
    criteria ? `\nAcceptance criteria:\n${criteria}` : '',
  ].filter(Boolean).join('\n')
}

function createAuditActor(actor: KanbanRunActorContext): Record<string, unknown> {
  return {
    type: 'local-browser',
    sessionId: actor.sessionId,
    remoteAddress: actor.access.remoteAddress,
    forwardedFor: actor.access.forwardedFor,
    loopback: actor.access.loopback,
    tailscale: actor.access.tailscale,
    trusted: actor.access.trusted,
    forwarded: actor.access.forwarded,
  }
}

function isKanbanRun(value: unknown): value is KanbanRun {
  return value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isActiveRunState(state: string): boolean {
  return ['queued', 'preparing_worktree', 'starting_codex', 'running', 'waiting_for_approval', 'running_tests', 'collecting_artifacts', 'stopping'].includes(state)
}

function extractThreadId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  const directThreadId = readString(record.threadId) || readString(record.thread_id)
  if (directThreadId) return directThreadId
  const thread = asRecord(record.thread)
  const threadId = readString(thread?.id)
  if (threadId) return threadId
  const turn = asRecord(record.turn)
  return readString(turn?.threadId) || readString(turn?.thread_id)
}

function extractTurnId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  const directTurnId = readString(record.turnId) || readString(record.turn_id)
  if (directTurnId) return directTurnId
  const turn = asRecord(record.turn)
  return readString(turn?.id) || readString(turn?.turnId) || readString(turn?.turn_id)
}

function extractLatestAssistantMessageText(payload: unknown, completedTurnId = ''): string {
  const turns = readTurns(payload)
  if (completedTurnId) {
    const completedTurn = turns.map(asRecord).find((turn) => readTurnId(turn) === completedTurnId)
    return completedTurn ? extractLatestAssistantMessageFromTurn(completedTurn) : ''
  }
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = asRecord(turns[turnIndex])
    const text = extractLatestAssistantMessageFromTurn(turn)
    if (text) return text
  }
  return ''
}

function extractLatestAssistantMessageFromTurn(turn: Record<string, unknown> | null): string {
  const items = [...readArray(turn?.items), ...readArray(turn?.messages)]
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = asRecord(items[itemIndex])
    if (!isAssistantItem(item)) continue
    const text = readMessageText(item).trim()
    if (text) return text
  }
  return ''
}

function readTurnId(turn: Record<string, unknown> | null): string {
  return readString(turn?.id) || readString(turn?.turnId) || readString(turn?.turn_id)
}

function readTurns(payload: unknown): unknown[] {
  const record = asRecord(payload)
  const thread = asRecord(record?.thread)
  const threadTurns = readArray(thread?.turns)
  if (threadTurns.length > 0) return threadTurns
  const turns = readArray(record?.turns)
  if (turns.length > 0) return turns
  return readArray(record?.data)
}

function isAssistantItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
  if (!item) return false
  const type = readString(item.type)
  const role = readString(item.role)
  const author = asRecord(item.author)
  const authorRole = readString(author?.role)
  return type === 'agentMessage' || type === 'assistantMessage' || role === 'assistant' || authorRole === 'assistant'
}

function readMessageText(item: Record<string, unknown>): string {
  const directText = readString(item.text) || readString(item.message) || readString(item.content)
  if (directText) return directText
  const message = asRecord(item.message)
  const messageText = readString(message?.text) || readString(message?.content)
  if (messageText) return messageText
  const blocks = [...readArray(item.content), ...readArray(message?.content)]
  const parts: string[] = []
  for (const block of blocks) {
    const record = asRecord(block)
    const text = readString(record?.text) || readString(record?.content)
    if (text.trim()) parts.push(text.trim())
  }
  return parts.join('\n')
}

function mergeUnique(existing: string[], next: string[]): string[] {
  return Array.from(new Set([...existing, ...next].filter(Boolean)))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}
