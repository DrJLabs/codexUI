import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { KanbanWorktreeManager } from '../../kanban/worktreeManager'
import { WorkspaceWorktreeService } from '../worktreeService'

const execFileAsync = promisify(execFile)

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function createGitRepo(): Promise<{ dataDir: string; projectRoot: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-worktree-service-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-worktree-service-repo-'))
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'initial'])
  return { dataDir, projectRoot }
}

describe('WorkspaceWorktreeService', () => {
  it('lists managed worktree status outside Kanban manager ownership', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const service = new WorkspaceWorktreeService({ dataDir, projectRoot })
    const managed = await manager.createManagedWorktree({ taskId: 'task_1', taskTitle: 'Shared status', runId: 'run_1' })

    const worktrees = await service.listWorktrees()

    expect(worktrees).toEqual([
      expect.objectContaining({
        taskId: 'task_1',
        runId: 'run_1',
        branchName: managed.branchName,
        worktreePath: managed.worktreePath,
        status: 'active',
        dirty: false,
        missing: false,
        stale: false,
        cleanupConfirmation: 'remove run_1',
      }),
    ])
    await expect(manager.listManagedWorktrees()).resolves.toEqual(worktrees)
  })

  it('finds locks when the workspace service starts from a repository subdirectory', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const subdirectory = join(projectRoot, 'packages', 'app')
    await mkdir(subdirectory, { recursive: true })
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const service = new WorkspaceWorktreeService({ dataDir, projectRoot: subdirectory })
    await manager.createManagedWorktree({ taskId: 'task_1', taskTitle: 'Subdir status', runId: 'run_1' })

    const worktrees = await service.listWorktrees()

    expect(worktrees).toHaveLength(1)
    expect(worktrees[0]).toMatchObject({ runId: 'run_1', status: 'active', projectRoot })
  })

  it('reports dirty worktrees and refuses shared cleanup', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const service = new WorkspaceWorktreeService({ dataDir, projectRoot })
    const managed = await manager.createManagedWorktree({ taskId: 'task_1', taskTitle: 'Dirty', runId: 'run_1' })
    await writeFile(join(managed.worktreePath, 'dirty.txt'), 'dirty', 'utf8')

    const [worktree] = await service.listWorktrees()

    expect(worktree).toMatchObject({ runId: 'run_1', status: 'dirty', dirty: true })
    await expect(service.cleanupWorktree({ runId: 'run_1', confirmation: 'remove run_1' }))
      .rejects
      .toThrow('Refusing to remove dirty managed worktree')
  })

  it('requires typed confirmation and marks clean worktrees removed', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const manager = new KanbanWorktreeManager({ dataDir, projectRoot })
    const service = new WorkspaceWorktreeService({ dataDir, projectRoot })
    await manager.createManagedWorktree({ taskId: 'task_1', taskTitle: 'Cleanup', runId: 'run_1' })

    await expect(service.cleanupWorktree({ runId: 'run_1', confirmation: 'remove run_2' }))
      .rejects
      .toThrow('Cleanup confirmation must equal')
    const removed = await service.cleanupWorktree({ runId: 'run_1', confirmation: 'remove run_1' })

    expect(removed).toMatchObject({ runId: 'run_1', status: 'removed', lockStatus: 'removed' })
  })
})
