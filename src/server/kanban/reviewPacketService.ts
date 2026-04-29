import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { KanbanReviewPacket, KanbanRun, KanbanTask } from '../../types/kanban'
import { buildReviewSnapshot } from '../reviewGit'
import { createKanbanId } from './ids'
import type { KanbanStateFileV1 } from './migrations'
import { KanbanStorage } from './storage'
import { KanbanTestRunner } from './testRunner'

const execFileAsync = promisify(execFile)

export class KanbanReviewPacketService {
  private readonly storage: KanbanStorage
  private readonly testRunner: KanbanTestRunner

  constructor(options: { storage: KanbanStorage; testRunner?: KanbanTestRunner }) {
    this.storage = options.storage
    this.testRunner = options.testRunner ?? new KanbanTestRunner()
  }

  async getPacketForTask(taskId: string): Promise<KanbanReviewPacket | null> {
    const state = await this.storage.load()
    const task = state.tasks[taskId]
    if (!task?.reviewPacketId) return null
    const packet = state.reviewPackets[task.reviewPacketId]
    return isReviewPacket(packet) ? packet : null
  }

  async generateForTask(taskId: string): Promise<{ packet: KanbanReviewPacket; task: KanbanTask }> {
    let task = await this.readTask(taskId)
    const run = await this.readRun(task.currentRunId)
    const worktreePath = run.worktreePath || task.worktreePath
    if (!worktreePath) {
      throw new Error(`Kanban task ${taskId} has no worktree path for review packet generation`)
    }
    const baseRev = run.baseRef || task.baseBranch || 'HEAD'
    const [baseCommit, headCommit, testResults] = await Promise.all([
      readGitCommit(worktreePath, baseRev),
      readGitCommit(worktreePath, 'HEAD'),
      this.testRunner.collectResults(),
    ])
    const unresolvedProposalIds = await this.readUnresolvedProposalIds(task.proposalIds)
    const snapshot = await buildPacketSnapshot(worktreePath, baseRev, baseCommit, headCommit)
    const rawDiffPatch = snapshot.files.map((file) => file.diff).filter(Boolean).join('\n')
    const packetBase = {
      taskUpdatedAtIso: task.updatedAtIso,
      runId: run.id,
      baseCommit,
      headCommit,
      rawDiffPatch,
      testResults,
      unresolvedProposalIds,
    }
    const packet: KanbanReviewPacket = {
      id: createKanbanId('review_packet'),
      taskId,
      runId: run.id,
      packetHash: createHash('sha256').update(JSON.stringify(packetBase)).digest('hex'),
      generatedAtIso: new Date().toISOString(),
      baseCommit,
      headCommit,
      rawDiffPatch,
      summary: snapshot.summary,
      testResults,
      unresolvedProposalIds,
    }
    await this.storage.mutate((state: KanbanStateFileV1) => {
      const currentTask = state.tasks[taskId]
      if (!currentTask) throw new Error(`Kanban task not found: ${taskId}`)
      state.reviewPackets[packet.id] = packet
      task = {
        ...currentTask,
        reviewPacketId: packet.id,
        status: 'review',
        updatedAtIso: new Date().toISOString(),
        version: currentTask.version + 1,
      }
      state.tasks[taskId] = task
    })
    return { packet, task }
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
    if (!isRun(run)) throw new Error(`Kanban run not found: ${runId}`)
    return run
  }

  private async readUnresolvedProposalIds(proposalIds: string[]): Promise<string[]> {
    if (proposalIds.length === 0) return []
    const state = await this.storage.load()
    return proposalIds.filter((proposalId) => isPendingProposal(state.proposals[proposalId]))
  }
}

function isRun(value: unknown): value is KanbanRun {
  return value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isReviewPacket(value: unknown): value is KanbanReviewPacket {
  return value !== null && typeof value === 'object' && typeof (value as { packetHash?: unknown }).packetHash === 'string'
}

function isPendingProposal(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && (value as { status?: unknown }).status === 'pending'
}

async function readGitCommit(cwd: string, rev: string): Promise<string> {
  if (!cwd) return ''
  const { stdout } = await execFileAsync('git', ['rev-parse', rev], { cwd })
  return stdout.trim()
}

async function buildPacketSnapshot(
  worktreePath: string,
  baseRev: string,
  baseCommit: string,
  headCommit: string,
): Promise<Awaited<ReturnType<typeof buildReviewSnapshot>>> {
  if (baseCommit && headCommit && baseCommit !== headCommit) {
    return await buildReviewSnapshot(worktreePath, 'baseBranch', 'unstaged', baseRev)
  }
  return await buildReviewSnapshot(worktreePath, 'workspace', 'unstaged')
}
