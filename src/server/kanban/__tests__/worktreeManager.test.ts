import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { KanbanWorktreeManager, resolveManagedWorktreeRoot } from '../worktreeManager'

const execFileAsync = promisify(execFile)

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function createGitRepo(): Promise<{ dataDir: string; projectRoot: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-worktree-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-kanban-worktree-repo-'))
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'initial'])
  return { dataDir, projectRoot }
}

describe('KanbanWorktreeManager', () => {
  it('creates a managed branch and worktree under the Kanban data root', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })

    const worktree = await manager.createManagedWorktree({
      taskId: 'task_123',
      taskTitle: 'Build board!',
      runId: 'run_1',
    })
    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])
    const lock = JSON.parse(await readFile(worktree.lockPath, 'utf8')) as { taskId: string; runId: string; pid: number }

    expect(worktree.branchName).toBe('codexui/task/task-123-run-1-build-board')
    expect(worktree.worktreePath.startsWith(resolveManagedWorktreeRoot(dataDir, projectRoot))).toBe(true)
    expect(worktreeList).toContain(worktree.worktreePath)
    expect(worktreeList).toContain(`branch refs/heads/${worktree.branchName}`)
    expect(lock.taskId).toBe('task_123')
    expect(lock.runId).toBe('run_1')
    expect(lock.pid).toBe(process.pid)
  })

  it('blocks a second active worktree for the same task', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })

    await manager.createManagedWorktree({ taskId: 'task_123', taskTitle: 'One', runId: 'run_1' })

    await expect(manager.createManagedWorktree({
      taskId: 'task_123',
      taskTitle: 'Two',
      runId: 'run_2',
    })).rejects.toThrow('Active Kanban worktree already exists for task task_123')
  })

  it('includes the run id in branch names so later runs do not collide with old branches', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })

    const first = await manager.createManagedWorktree({ taskId: 'task_123', taskTitle: 'Same title', runId: 'run_1' })
    await manager.removeManagedWorktree({ runId: 'run_1' })
    const second = await manager.createManagedWorktree({ taskId: 'task_123', taskTitle: 'Same title', runId: 'run_2' })

    expect(first.branchName).toBe('codexui/task/task-123-run-1-same-title')
    expect(second.branchName).toBe('codexui/task/task-123-run-2-same-title')
  })

  it('keeps long branch segments unique after truncation', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const sharedPrefix = `task_${'a'.repeat(120)}`

    const first = await manager.createManagedWorktree({
      taskId: `${sharedPrefix}_one`,
      taskTitle: 'Same title',
      runId: `${sharedPrefix}_run_one`,
    })
    const second = await manager.createManagedWorktree({
      taskId: `${sharedPrefix}_two`,
      taskTitle: 'Same title',
      runId: `${sharedPrefix}_run_two`,
    })

    expect(first.branchName).not.toBe(second.branchName)
  })

  it('removes the worktree and branch when lock writing fails', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const worktreeRoot = resolveManagedWorktreeRoot(dataDir, projectRoot)
    await mkdir(join(worktreeRoot, 'run-1', 'codexui-kanban-worktree.json'), { recursive: true })

    await expect(manager.createManagedWorktree({
      taskId: 'task_123',
      taskTitle: 'Lock failure',
      runId: 'run_1',
    })).rejects.toThrow()

    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])
    const branches = await runGit(projectRoot, ['branch', '--list', 'codexui/task/*'])
    expect(worktreeList).not.toContain('run-1')
    expect(branches.trim()).toBe('')
  })

  it('refuses to remove dirty managed worktrees', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const worktree = await manager.createManagedWorktree({ taskId: 'task_123', taskTitle: 'Dirty cleanup', runId: 'run_1' })
    await mkdir(worktree.worktreePath, { recursive: true })
    await writeFile(join(worktree.worktreePath, 'dirty.txt'), 'dirty', 'utf8')

    await expect(manager.removeManagedWorktree({ runId: 'run_1' })).rejects.toThrow('Refusing to remove dirty Kanban worktree')
  })

  it('requires typed confirmation and no active run for cleanup', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    await manager.createManagedWorktree({ taskId: 'task_123', taskTitle: 'Cleanup', runId: 'run_1' })

    await expect(manager.cleanupManagedWorktree({ runId: 'run_1', confirmation: 'remove run_2' })).rejects.toThrow('Cleanup confirmation must equal')
    await expect(manager.cleanupManagedWorktree({ runId: 'run_1', confirmation: 'remove run_1', activeRunIds: ['run_1'] })).rejects.toThrow('Cannot clean up active Kanban run')
  })
})
