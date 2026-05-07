import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { MANAGED_WORKTREE_LOCK_FILENAME, resolveManagedWorktreeRoot } from '../worktreeLocks'
import { ManagedWorktreeService } from '../managedWorktreeService'

const execFileAsync = promisify(execFile)

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function createGitRepo(): Promise<{ dataDir: string; projectRoot: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-managed-worktree-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-managed-worktree-repo-'))
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'initial'])
  return { dataDir, projectRoot }
}

describe('ManagedWorktreeService', () => {
  it('creates an automation-owned worktree with shared lock metadata', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const service = new ManagedWorktreeService({ dataDir, projectRoot })

    const worktree = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'daily-check',
      runId: 'automation_run_1',
      name: 'Daily Check',
    })
    const lock = JSON.parse(await readFile(worktree.lockPath, 'utf8')) as {
      taskId: string
      owner?: { source: string; id: string }
      runId: string
      branchName: string
      worktreePath: string
    }
    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])

    expect(worktree.branchName).toBe('codexui/automation/daily-check-automation_run_1-daily-check')
    expect(worktree.lockPath.endsWith(MANAGED_WORKTREE_LOCK_FILENAME)).toBe(true)
    expect(worktree.worktreePath.startsWith(resolveManagedWorktreeRoot(dataDir, projectRoot))).toBe(true)
    expect(worktreeList).toContain(worktree.worktreePath)
    expect(worktreeList).toContain(`branch refs/heads/${worktree.branchName}`)
    expect(lock).toMatchObject({
      taskId: 'daily-check',
      owner: { source: 'automation', id: 'daily-check' },
      runId: 'automation_run_1',
      branchName: worktree.branchName,
      worktreePath: worktree.worktreePath,
    })
  })

  it('blocks a second active worktree for the same automation owner', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const service = new ManagedWorktreeService({ dataDir, projectRoot })
    await service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'legacy-task-id',
      runId: 'automation-run-1',
      name: 'Daily Check',
    })

    await expect(service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'daily-check',
      runId: 'automation-run-2',
      name: 'Daily Check Again',
    })).rejects.toThrow('Active managed worktree already exists for automation daily-check')
  })

  it('preserves dirty active worktrees when duplicate creation is blocked', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const service = new ManagedWorktreeService({ dataDir, projectRoot })
    const first = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'daily-check',
      runId: 'automation-run-1',
      name: 'Dirty Check',
    })
    await writeFile(join(first.worktreePath, 'dirty.txt'), 'dirty', 'utf8')

    await expect(service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'daily-check',
      runId: 'automation-run-2',
      name: 'Second Check',
    })).rejects.toThrow('Active managed worktree already exists for automation daily-check')

    await expect(readFile(join(first.worktreePath, 'dirty.txt'), 'utf8')).resolves.toBe('dirty')
    await expect(readFile(first.lockPath, 'utf8')).resolves.toContain('"status": "active"')
  })

  it('warns when skipping malformed managed worktree lock files', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const service = new ManagedWorktreeService({ dataDir, projectRoot })
    const first = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'daily-check',
      runId: 'automation-run-1',
      name: 'Daily Check',
    })
    await writeFile(first.lockPath, '{not json', 'utf8')
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await expect(service.createManagedWorktree({
        owner: { source: 'automation', id: 'daily-check' },
        taskId: 'daily-check',
        runId: 'automation-run-2',
        name: 'Second Check',
      })).resolves.toMatchObject({ runId: 'automation-run-2' })
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed managed worktree lock'),
        expect.objectContaining({ name: 'SyntaxError' }),
      )
    } finally {
      consoleWarn.mockRestore()
    }
  })

  it('removes the created worktree and branch when lock writing fails', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const service = new ManagedWorktreeService({ dataDir, projectRoot })
    await mkdir(join(resolveManagedWorktreeRoot(dataDir, projectRoot), 'automation-run-1', MANAGED_WORKTREE_LOCK_FILENAME), { recursive: true })

    await expect(service.createManagedWorktree({
      owner: { source: 'automation', id: 'daily-check' },
      taskId: 'daily-check',
      runId: 'automation-run-1',
      name: 'Lock Failure',
    })).rejects.toThrow()

    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])
    const branches = await runGit(projectRoot, ['branch', '--list', 'codexui/automation/*'])
    expect(worktreeList).not.toContain('automation-run-1')
    expect(branches.trim()).toBe('')
  })
})
