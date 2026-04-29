import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { KanbanExecutionPolicy, KanbanRun } from '../../../types/kanban'
import { KanbanReviewPacketService } from '../reviewPacketService'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'

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

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-packet-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-kanban-packet-repo-'))
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await writeFile(join(projectRoot, 'README.md'), 'initial\n', 'utf8')
  await runGit(projectRoot, ['add', 'README.md'])
  await runGit(projectRoot, ['commit', '-m', 'initial'])
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const service = new KanbanTaskService({ storage, projectRoot, policy })
  const task = await service.createTask({ title: 'Review me' })
  const run: KanbanRun = {
    id: 'run_1',
    taskId: task.id,
    state: 'running',
    projectRoot,
    worktreePath: projectRoot,
    branchName: 'codexui/task/review-me',
    threadId: 'thread_1',
    turnId: 'turn_1',
    logPath: join(dataDir, 'logs.txt'),
    eventsPath: join(dataDir, 'events.jsonl'),
    errorMessage: '',
    createdAtIso: task.createdAtIso,
    updatedAtIso: task.updatedAtIso,
  }
  await storage.mutate((state) => {
    state.runs[run.id] = run
    state.tasks[task.id] = { ...state.tasks[task.id]!, currentRunId: run.id }
  })
  return { projectRoot, storage, taskId: task.id }
}

describe('KanbanReviewPacketService', () => {
  it('generates a review packet hash from task, run, diff, and tests', async () => {
    const { projectRoot, storage, taskId } = await createHarness()
    await writeFile(join(projectRoot, 'README.md'), 'initial\nchanged\n', 'utf8')
    const service = new KanbanReviewPacketService({ storage })

    const first = await service.generateForTask(taskId)
    const second = await service.generateForTask(taskId)

    expect(first.packet.packetHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.packet.rawDiffPatch).toContain('changed')
    expect(first.packet.summary.fileCount).toBe(1)
    expect(first.packet.packetHash).not.toBe(second.packet.packetHash)
    expect(second.task.reviewPacketId).toBe(second.packet.id)
    expect(second.task.status).toBe('review')
  })
})
