import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { KanbanRun, KanbanTask, StartKanbanRunResponse, InterruptKanbanRunResponse } from '../../types/kanban'
import type { KanbanAuditSink } from './auditLog'
import { createKanbanCodexBridgeAdapter, type KanbanCodexBridgeAdapter } from './codexBridgeAdapter'
import { createKanbanId } from './ids'
import { resolveProjectRunDir } from './paths'
import type { KanbanRemoteAccess } from './remoteAccess'
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
}

export type KanbanRunActorContext = {
  access: KanbanRemoteAccess
  sessionId: string
}

export class CodexKanbanRunner {
  private readonly dataDir: string
  private readonly projectRoot: string
  private readonly storage: KanbanStorage
  private readonly worktreeManager: KanbanWorktreeManager
  private readonly bridge: KanbanCodexBridgeAdapter
  private readonly auditLog: KanbanAuditSink
  private readonly queue = new KanbanTaskQueue()

  constructor(options: CodexKanbanRunnerOptions) {
    this.dataDir = options.dataDir
    this.projectRoot = options.projectRoot
    this.storage = options.storage
    this.worktreeManager = options.worktreeManager
    this.bridge = createKanbanCodexBridgeAdapter(options.bridge)
    this.auditLog = options.auditLog
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
      await this.persistRun(run, { runState: 'preparing_worktree' })
      const worktree = await this.worktreeManager.createManagedWorktree({
        taskId,
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
    } catch (error) {
      this.queue.complete(run.id)
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
    this.queue.complete(runId)
    return { run: cancelledRun, task }
  }

  async getRun(runId: string): Promise<KanbanRun> {
    return await this.readRun(runId)
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
    loopback: actor.access.loopback,
    forwarded: actor.access.forwarded,
  }
}

function isKanbanRun(value: unknown): value is KanbanRun {
  return value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
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
