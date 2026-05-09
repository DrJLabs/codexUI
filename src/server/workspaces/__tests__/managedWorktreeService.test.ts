import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
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

  it('uses the source repository current branch as the managed worktree base', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    await runGit(projectRoot, ['switch', '-c', 'feature/source-work'])
    await writeFile(join(projectRoot, 'feature.txt'), 'feature branch content', 'utf8')
    await runGit(projectRoot, ['add', 'feature.txt'])
    await runGit(projectRoot, ['commit', '-m', 'feature content'])
    const service = new ManagedWorktreeService({ dataDir, projectRoot })

    const worktree = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'branch-check' },
      taskId: 'branch-check',
      runId: 'automation-run-branch',
      name: 'Branch Check',
    })

    expect(worktree.baseRef).toBe('feature/source-work')
    await expect(readFile(join(worktree.worktreePath, 'feature.txt'), 'utf8')).resolves.toBe('feature branch content')
  })

  it('maps a source subdirectory to the matching worktree workspace root', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    await mkdir(join(projectRoot, 'packages', 'app'), { recursive: true })
    await writeFile(join(projectRoot, 'packages', 'app', 'package.json'), '{"name":"app"}\n', 'utf8')
    await runGit(projectRoot, ['add', 'packages/app/package.json'])
    await runGit(projectRoot, ['commit', '-m', 'add app package'])
    const sourceWorkspaceRoot = join(projectRoot, 'packages', 'app')
    const service = new ManagedWorktreeService({ dataDir, projectRoot: sourceWorkspaceRoot })

    const worktree = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'subdir-check' },
      taskId: 'subdir-check',
      runId: 'automation-run-subdir',
      name: 'Subdir Check',
    })

    expect(worktree.worktreeWorkspaceRoot).toBe(join(worktree.worktreePath, 'packages', 'app'))
    await expect(readFile(join(worktree.worktreeWorkspaceRoot, 'package.json'), 'utf8')).resolves.toBe('{"name":"app"}\n')
  })

  it('stores and applies Desktop local environment setup for managed worktrees', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const localEnvironmentConfigPath = join(projectRoot, '.codex', 'local-env.toml')
    await mkdir(join(projectRoot, '.codex'), { recursive: true })
    await writeFile(localEnvironmentConfigPath, `version = 1
name = "Test setup"

[setup]
script = """
printf "%s\\n" "$CODEX_SOURCE_TREE_PATH" > setup-env.txt
printf "%s\\n" "$CODEX_WORKTREE_PATH" >> setup-env.txt
printf "%s\\n" "$PWD" >> setup-env.txt
export CODEXUI_LOCAL_ENV_MARKER=ready
"""
`, 'utf8')
    const service = new ManagedWorktreeService({ dataDir, projectRoot })

    const worktree = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'local-env-check' },
      taskId: 'local-env-check',
      runId: 'automation-run-local-env',
      name: 'Local Env Check',
      localEnvironmentConfigPath,
    })
    const selectedConfig = await runGit(worktree.worktreePath, ['config', '--worktree', '--get', 'codex.localEnvironmentConfigPath'])
    const shellEnvironmentPath = (await runGit(worktree.worktreePath, ['rev-parse', '--git-path', 'codex-shell-environment.json'])).trim()
    const shellEnvironment = JSON.parse(await readFile(isAbsolute(shellEnvironmentPath) ? shellEnvironmentPath : join(worktree.worktreePath, shellEnvironmentPath), 'utf8')) as {
      set: Record<string, string>
    }

    expect(selectedConfig.trim()).toBe(localEnvironmentConfigPath)
    expect(worktree.localEnvironmentConfigPath).toBe(localEnvironmentConfigPath)
    expect(worktree.localEnvironmentSetup).toMatchObject({ status: 'succeeded', cwd: worktree.worktreePath })
    await expect(readFile(join(worktree.worktreePath, 'setup-env.txt'), 'utf8')).resolves.toBe([
      projectRoot,
      worktree.worktreePath,
      worktree.worktreePath,
      '',
    ].join('\n'))
    expect(shellEnvironment.set.CODEXUI_LOCAL_ENV_MARKER).toBe('ready')
  })

  it('stores Desktop no-environment marker when no local environment is selected', async () => {
    const { dataDir, projectRoot } = await createGitRepo()
    const service = new ManagedWorktreeService({ dataDir, projectRoot })

    const worktree = await service.createManagedWorktree({
      owner: { source: 'automation', id: 'no-env-check' },
      taskId: 'no-env-check',
      runId: 'automation-run-no-env',
      name: 'No Env Check',
    })
    const selectedConfig = await runGit(worktree.worktreePath, ['config', '--worktree', '--get', 'codex.localEnvironmentConfigPath'])

    expect(selectedConfig.trim()).toBe('__none__')
    expect(worktree.localEnvironmentConfigPath).toBeNull()
    expect(worktree.localEnvironmentSetup).toBeNull()
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
