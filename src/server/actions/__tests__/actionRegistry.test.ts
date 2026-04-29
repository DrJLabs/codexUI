import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodexRunProfile } from '../../../types/kanban'
import type { LocalActionPolicy } from '../../../types/localActions'
import { assertLocalActionAllowed, discoverLocalActions } from '../actionRegistry'

const runProfile: CodexRunProfile = {
  id: 'workspace-coding',
  name: 'Workspace coding',
  description: 'Default coding profile.',
  model: '',
  reasoningEffort: 'medium',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
  writableRoots: [],
  createdAtIso: '2026-04-29T00:00:00.000Z',
  updatedAtIso: '2026-04-29T00:00:00.000Z',
}

const enabledPolicy: LocalActionPolicy = {
  executionMode: 'trusted_remote',
  executionEnabled: true,
  trustedForExecution: true,
  allowDangerFullAccess: false,
  allowApprovalNever: false,
}

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'codexui-local-actions-'))
  await mkdir(join(cwd, 'src'), { recursive: true })
  await writeFile(join(cwd, 'pnpm-lock.yaml'), '', 'utf8')
  await writeFile(join(cwd, 'package.json'), `${JSON.stringify({
    scripts: {
      build: 'vite build',
      test: 'vitest run',
      dev: 'vite --host 0.0.0.0',
      deploy: 'git push origin main',
    },
  }, null, 2)}\n`, 'utf8')
  return cwd
}

describe('actionRegistry', () => {
  it('discovers build, test, and dev package actions with the selected run profile', async () => {
    const cwd = await createProject()

    const actions = discoverLocalActions({
      cwd,
      runProfile,
      policy: enabledPolicy,
      nowIso: '2026-04-29T00:00:00.000Z',
    })

    expect(actions.map((action) => [action.kind, action.command, action.runProfile.id])).toEqual([
      ['build', 'pnpm run build', 'workspace-coding'],
      ['test', 'pnpm run test', 'workspace-coding'],
      ['dev', 'pnpm run dev', 'workspace-coding'],
    ])
  })

  it('requires execution trust and keeps dangerous profiles available behind explicit policy toggles', async () => {
    const cwd = await createProject()
    const [action] = discoverLocalActions({
      cwd,
      runProfile: { ...runProfile, sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
      policy: enabledPolicy,
    })

    expect(() => assertLocalActionAllowed(action!, enabledPolicy))
      .toThrow('danger-full-access')
    expect(() => assertLocalActionAllowed(action!, { ...enabledPolicy, allowDangerFullAccess: true }))
      .toThrow('approval-never')
    expect(() => assertLocalActionAllowed(action!, {
      ...enabledPolicy,
      allowDangerFullAccess: true,
      allowApprovalNever: true,
    })).not.toThrow()
    expect(() => assertLocalActionAllowed(action!, { ...enabledPolicy, trustedForExecution: false }))
      .toThrow('trusted execution context')
  })

  it('blocks merge and push commands until a separate confirmation flow exists', async () => {
    const cwd = await createProject()
    const action = {
      ...discoverLocalActions({ cwd, runProfile, policy: enabledPolicy })[0]!,
      command: 'git push origin main',
    }

    expect(() => assertLocalActionAllowed(action, enabledPolicy))
      .toThrow('cannot push, pull, merge, or rebase')
  })

  it('blocks package scripts whose resolved body pushes or merges', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'codexui-local-actions-dangerous-'))
    await writeFile(join(cwd, 'package.json'), `${JSON.stringify({
      scripts: {
        build: 'git -C ../repo push origin main',
      },
    }, null, 2)}\n`, 'utf8')

    const [action] = discoverLocalActions({ cwd, runProfile, policy: enabledPolicy })

    expect(action?.command).toBe('npm run build')
    expect(action?.scriptCommand).toBe('git -C ../repo push origin main')
    expect(() => assertLocalActionAllowed(action!, enabledPolicy))
      .toThrow('cannot push, pull, merge, or rebase')
  })

  it('blocks pull and rebase commands until a separate confirmation flow exists', async () => {
    const cwd = await createProject()
    const baseAction = discoverLocalActions({ cwd, runProfile, policy: enabledPolicy })[0]!

    expect(() => assertLocalActionAllowed({ ...baseAction, command: 'git pull --rebase' }, enabledPolicy))
      .toThrow('cannot push, pull, merge, or rebase')
    expect(() => assertLocalActionAllowed({ ...baseAction, command: 'git -C ../repo rebase main' }, enabledPolicy))
      .toThrow('cannot push, pull, merge, or rebase')
  })
})
