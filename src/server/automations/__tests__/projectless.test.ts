import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAutomationCreateInput, parseAutomationPatchInput } from '../schema'
import {
  buildProjectlessAutomationInstructions,
  createProjectlessAutomationWorkspace,
  isProjectlessCwd,
} from '../projectless'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true })
  }))
})

describe('projectless automation workspace helpers', () => {
  it('matches Desktop projectless folder naming under Documents/Codex', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'codexui-projectless-home-'))
    tempDirs.push(homeDir)

    const workspace = await createProjectlessAutomationWorkspace({
      homeDir,
      now: new Date('2026-05-07T12:00:00.000Z'),
      prompt: 'Check repo status and summarize blockers',
    })

    expect(workspace.workspaceRoot).toBe(join(homeDir, 'Documents', 'Codex'))
    expect(workspace.cwd).toBe(join(homeDir, 'Documents', 'Codex', '2026-05-07', 'check-repo-status-and-summarize-blockers'))
    expect((await stat(workspace.cwd)).isDirectory()).toBe(true)
  })

  it('adds numeric suffixes when a projectless directory already exists', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'codexui-projectless-home-'))
    tempDirs.push(homeDir)

    const first = await createProjectlessAutomationWorkspace({
      homeDir,
      now: new Date('2026-05-07T12:00:00.000Z'),
      prompt: 'hi',
    })
    const second = await createProjectlessAutomationWorkspace({
      homeDir,
      now: new Date('2026-05-07T12:00:00.000Z'),
      prompt: 'hi',
    })

    expect(first.cwd.endsWith('/hi')).toBe(true)
    expect(second.cwd.endsWith('/hi-2')).toBe(true)
  })

  it('builds Desktop projectless developer instructions', () => {
    expect(buildProjectlessAutomationInstructions('/tmp/output')).toContain('### Projectless Chat')
    expect(buildProjectlessAutomationInstructions('/tmp/output')).toContain('put them in /tmp/output')
  })

  it('detects the Desktop projectless cwd sentinel', () => {
    expect(isProjectlessCwd('~')).toBe(true)
    expect(isProjectlessCwd(' /tmp/project ')).toBe(false)
  })

  it('accepts projectless create and patch payloads without treating ~ as a relative path', () => {
    expect(parseAutomationCreateInput({
      kind: 'cron',
      name: 'Projectless cron',
      description: null,
      prompt: 'Run anywhere',
      schedule: { type: 'rrule', rrule: 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      targetThreadId: null,
      cwd: '~',
      cwds: ['~'],
      runMode: 'worktree',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })).toMatchObject({
      cwd: '~',
      cwds: ['~'],
      runMode: 'worktree',
    })

    expect(parseAutomationPatchInput({ runMode: 'local', cwds: ['~'] })).toMatchObject({
      cwd: '~',
      cwds: ['~'],
      runMode: 'local',
    })
  })
})
