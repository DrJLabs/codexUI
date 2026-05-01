import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteThreadHeartbeatAutomation,
  listNativeAutomationEntries,
  listThreadHeartbeatAutomations,
  parseAutomationToml,
  readThreadHeartbeatAutomation,
  serializeAutomationToml,
  writeNativeAutomation,
  writeThreadHeartbeatAutomation,
  type ThreadAutomationRecord,
} from '../nativeStore'
import {
  normalizeThreadAutomationStatus,
  parseThreadAutomationWritePayload,
} from '../legacyAdapter'

const codexHomeDirs: string[] = []

afterEach(async () => {
  await Promise.all(codexHomeDirs.splice(0).map(async (codexHomeDir) => {
    await rm(codexHomeDir, { recursive: true, force: true })
  }))
})

async function createCodexHome() {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automations-test-'))
  codexHomeDirs.push(codexHomeDir)
  return codexHomeDir
}

const pausedRecord: ThreadAutomationRecord = {
  id: 'daily-check',
  kind: 'heartbeat',
  name: 'Daily Check',
  prompt: 'Check the thread',
  rrule: 'FREQ=DAILY;INTERVAL=1',
  rrulePrefix: null,
  status: 'PAUSED',
  targetThreadId: 'thread-123',
  model: null,
  reasoningEffort: null,
  executionEnvironment: null,
  runMode: null,
  cwd: null,
  cwds: [],
  createdAtMs: 1710000000000,
  updatedAtMs: 1710000005000,
  nextRunAtMs: null,
}

describe('native automation store TOML compatibility', () => {
  it('parses Desktop cron automation fields from the canonical fixture', async () => {
    const raw = await readFile('fixtures/desktop-automations/hourly-fixture/automation.toml', 'utf8')

    expect(parseAutomationToml(raw)).toMatchObject({
      id: 'hourly-fixture',
      kind: 'cron',
      name: 'hourly fixture',
      status: 'ACTIVE',
      rrule: 'FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA',
      rrulePrefix: 'RRULE:',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      executionEnvironment: 'worktree',
      runMode: 'worktree',
      cwd: '/mnt/c/Users/projects/apollo',
      cwds: ['/mnt/c/Users/projects/apollo'],
      targetThreadId: null,
      createdAtMs: 1777654085276,
      updatedAtMs: 1777654085276,
    })
  })

  it('parses TOML string arrays for cwds without dropping additional paths', () => {
    const raw = [
      'version = 1',
      'id = "multi-cwd"',
      'kind = "cron"',
      'name = "Multi cwd"',
      'prompt = "Run"',
      'status = "ACTIVE"',
      'rrule = "RRULE:FREQ=DAILY"',
      'execution_environment = "worktree"',
      'cwds = ["/repo/one", "/repo/two"]',
      'created_at = 1777654085276',
      'updated_at = 1777654085276',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toMatchObject({
      cwd: '/repo/one',
      cwds: ['/repo/one', '/repo/two'],
    })
  })

  it('parses a top-level Desktop cwd when cwds is absent', () => {
    const raw = [
      'version = 1',
      'id = "single-cwd"',
      'kind = "cron"',
      'name = "Single cwd"',
      'prompt = "Run"',
      'status = "ACTIVE"',
      'rrule = "RRULE:FREQ=DAILY"',
      'execution_environment = "worktree"',
      'cwd = "/repo/single"',
      'created_at = 1777654085276',
      'updated_at = 1777654085276',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toMatchObject({
      cwd: '/repo/single',
      cwds: ['/repo/single'],
    })
  })

  it('parses multiline Desktop cwds arrays with comments, brackets, and multiline strings', () => {
    const raw = [
      'version = 1',
      'id = "multi-line-cwds"',
      'kind = "cron"',
      'name = "Multiline cwds"',
      'prompt = "Run"',
      'status = "ACTIVE"',
      'rrule = "RRULE:FREQ=DAILY"',
      'execution_environment = "worktree"',
      'cwds = [',
      '  """',
      '/repo/[one]',
      '""", # primary',
      '  "/repo/two",',
      ']',
      'created_at = 1777654085276',
      'updated_at = 1777654085276',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toMatchObject({
      cwd: '/repo/[one]',
      cwds: ['/repo/[one]', '/repo/two'],
    })
  })

  it('preserves Desktop cron fields and omits empty target_thread_id on no-op writeback', async () => {
    const previousRaw = await readFile('fixtures/desktop-automations/hourly-fixture/automation.toml', 'utf8')
    const record = parseAutomationToml(previousRaw)
    expect(record).not.toBeNull()

    const nextRaw = serializeAutomationToml(record!, previousRaw)

    expect(nextRaw).toContain('kind = "cron"')
    expect(nextRaw).toContain('rrule = "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA"')
    expect(nextRaw).toContain('model = "gpt-5.5"')
    expect(nextRaw).toContain('reasoning_effort = "low"')
    expect(nextRaw).toContain('execution_environment = "worktree"')
    expect(nextRaw).toContain('cwd = "/mnt/c/Users/projects/apollo"')
    expect(nextRaw).toContain('cwds = ["/mnt/c/Users/projects/apollo"]')
    expect(nextRaw).not.toContain('target_thread_id = ""')
  })

  it('updates or removes top-level cwd during TOML writeback', () => {
    const previousRaw = `${serializeAutomationToml({
      ...pausedRecord,
      kind: 'cron',
      targetThreadId: null,
      cwd: '/old/repo',
      cwds: ['/old/repo'],
    })}desktop_only = "keep"\n`

    const nextRaw = serializeAutomationToml({
      ...pausedRecord,
      kind: 'cron',
      targetThreadId: null,
      cwd: null,
      cwds: [],
    }, previousRaw)

    expect(nextRaw).not.toContain('cwd = "/old/repo"')
    expect(nextRaw).not.toContain('cwds = ["/old/repo"]')
    expect(nextRaw).toContain('desktop_only = "keep"')
  })

  it('replaces the full multiline cwds array during TOML writeback', () => {
    const previousRaw = [
      'version = 1',
      'id = "daily-check"',
      'kind = "cron"',
      'name = "Daily Check"',
      'prompt = "Check the thread"',
      'status = "PAUSED"',
      'rrule = "FREQ=DAILY;INTERVAL=1"',
      'cwd = "/old/repo"',
      'cwds = [',
      '  "/old/repo",',
      '  "/old/[two]",',
      ']',
      'created_at = 1710000000000',
      'updated_at = 1710000005000',
      'desktop_only = "keep"',
      '',
    ].join('\n')

    const nextRaw = serializeAutomationToml({
      ...pausedRecord,
      kind: 'cron',
      targetThreadId: null,
      cwd: '/new/repo',
      cwds: ['/new/repo'],
    }, previousRaw)

    expect(nextRaw).toContain('cwd = "/new/repo"')
    expect(nextRaw).toContain('cwds = ["/new/repo"]')
    expect(nextRaw).not.toContain('/old/repo')
    expect(nextRaw).not.toContain('/old/[two]')
    expect(nextRaw).toContain('desktop_only = "keep"')
    expect(parseAutomationToml(nextRaw)).toMatchObject({
      cwd: '/new/repo',
      cwds: ['/new/repo'],
    })
  })

  it('keeps an existing empty target_thread_id key when preserving a legacy file that already had one', () => {
    const previousRaw = `${serializeAutomationToml({
      ...pausedRecord,
      targetThreadId: null,
    })}target_thread_id = ""\ndesktop_only = "keep"\n`
    const record = parseAutomationToml(previousRaw)
    expect(record).not.toBeNull()

    const nextRaw = serializeAutomationToml(record!, previousRaw)

    expect(nextRaw).toContain('target_thread_id = ""')
    expect(nextRaw).toContain('desktop_only = "keep"')
  })

  it('round trips CodexUI TOML records with uppercase PAUSED status', () => {
    const raw = serializeAutomationToml(pausedRecord)

    expect(raw).toContain('version = 1')
    expect(raw).toContain('status = "PAUSED"')
    expect(raw).toContain('target_thread_id = "thread-123"')
    expect(parseAutomationToml(raw)).toEqual(pausedRecord)
  })

  it('tolerates unknown top-level TOML fields while parsing known fields', () => {
    const raw = `${serializeAutomationToml(pausedRecord)}desktop_only = "ignored"\nnext_run_at = "2026-05-01T00:00:00Z"\n`

    expect(parseAutomationToml(raw)).toEqual(pausedRecord)
  })

  it('parses known top-level TOML fields with trailing comments', () => {
    const raw = [
      'version = 1 # generated by another tool',
      'id = "daily-check" # keep id',
      'kind = "heartbeat"',
      'name = "Daily # Check" # comment after quoted value',
      "prompt = 'Check # literally'",
      'status = "PAUSED" # paused on purpose',
      'rrule = "FREQ=DAILY;INTERVAL=1" # every day',
      'target_thread_id = "thread-123" # target',
      'created_at = 1710000000000 # ms',
      'updated_at = 1710000005000 # ms',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toEqual({
      ...pausedRecord,
      name: 'Daily # Check',
      prompt: 'Check # literally',
    })
  })

  it('parses multiline basic and literal TOML strings without treating key-like body lines as assignments', () => {
    const raw = [
      'version = 1',
      'id = "daily-check"',
      'kind = "heartbeat"',
      'name = """',
      'Daily Check',
      '""" # display name',
      "prompt = '''",
      'Check the thread',
      'status = "ACTIVE"',
      "''' # literal prompt",
      'status = "PAUSED"',
      'rrule = "FREQ=DAILY;INTERVAL=1"',
      'target_thread_id = "thread-123"',
      'created_at = 1710000000000',
      'updated_at = 1710000005000',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toEqual({
      ...pausedRecord,
      name: 'Daily Check',
      prompt: 'Check the thread\nstatus = "ACTIVE"',
    })
  })

  it('does not treat key-like lines inside multiline TOML strings as top-level fields while updating', () => {
    const previousRaw = [
      '# keep comment',
      'prompt = """',
      'old prompt body',
      'id = "inside prompt"',
      '"""',
      'id = "old-id"',
      'kind = "heartbeat"',
      'name = "Old Name"',
      'status = "PAUSED"',
      'rrule = "FREQ=DAILY"',
      'target_thread_id = "thread-123"',
      'created_at = 1710000000000',
      'updated_at = 1710000000000',
      'unknown_notes = """',
      'keep unknown body',
      'prompt = "inside unknown"',
      '"""',
      '',
    ].join('\n')

    const raw = serializeAutomationToml(pausedRecord, previousRaw)

    expect(raw).toContain('# keep comment')
    expect(raw).toContain('unknown_notes = """\nkeep unknown body\nprompt = "inside unknown"\n"""')
    expect(raw).toContain('id = "daily-check"')
    expect(raw).toContain('prompt = "Check the thread"')
    expect(raw).not.toContain('id = "inside prompt"')
    expect(parseAutomationToml(raw)).toEqual(pausedRecord)
  })

  it('does not close multiline basic strings on escaped triple quotes', () => {
    const raw = [
      'version = 1',
      'id = "daily-check"',
      'kind = "heartbeat"',
      'name = "Daily Check"',
      'prompt = """',
      'Say \\""" literally',
      'and continue',
      '"""',
      'status = "PAUSED"',
      'rrule = "FREQ=DAILY;INTERVAL=1"',
      'target_thread_id = "thread-123"',
      'created_at = 1710000000000',
      'updated_at = 1710000005000',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toEqual({
      ...pausedRecord,
      prompt: 'Say """ literally\nand continue',
    })
  })

  it('does not strip comment-like text after escaped triple quotes inside multiline basic strings', () => {
    const raw = [
      'version = 1',
      'id = "daily-check"',
      'kind = "heartbeat"',
      'name = "Daily Check"',
      'prompt = """',
      'Say \\""" literally # not a comment',
      'and continue',
      '""" # real comment',
      'status = "PAUSED"',
      'rrule = "FREQ=DAILY;INTERVAL=1"',
      'target_thread_id = "thread-123"',
      'created_at = 1710000000000',
      'updated_at = 1710000005000',
      '',
    ].join('\n')

    expect(parseAutomationToml(raw)).toEqual({
      ...pausedRecord,
      prompt: 'Say """ literally # not a comment\nand continue',
    })
  })

  it('returns null for invalid or partial records', () => {
    expect(parseAutomationToml('id = "missing-required-fields"\n')).toBeNull()
    expect(parseAutomationToml(`${serializeAutomationToml(pausedRecord)}kind = "timer"\n`)).toBeNull()
    expect(parseAutomationToml(`${serializeAutomationToml(pausedRecord)}status = "disabled"\n`)).toBeNull()
  })
})

describe('native automation store filesystem behavior', () => {
  it('lists, reads, writes, and deletes thread heartbeat automations from an injected Codex home', async () => {
    const codexHomeDir = await createCodexHome()
    const automationRoot = join(codexHomeDir, 'automations')
    const invalidDir = join(automationRoot, 'partial')
    await mkdir(invalidDir, { recursive: true })
    await writeFile(join(invalidDir, 'automation.toml'), 'id = "partial"\nname = "Partial"\n', 'utf8')
    const cronDir = join(automationRoot, 'cron')
    await mkdir(cronDir, { recursive: true })
    await writeFile(join(cronDir, 'automation.toml'), serializeAutomationToml({
      ...pausedRecord,
      id: 'cron',
      kind: 'cron',
      targetThreadId: 'thread-cron',
    }), 'utf8')
    const unattachedDir = join(automationRoot, 'unattached')
    await mkdir(unattachedDir, { recursive: true })
    await writeFile(join(unattachedDir, 'automation.toml'), serializeAutomationToml({
      ...pausedRecord,
      id: 'unattached',
      targetThreadId: null,
    }), 'utf8')

    const storeOptions = { codexHomeDir: ` ${codexHomeDir} ` }
    const written = await writeThreadHeartbeatAutomation(
      {
        threadId: ' thread-abc ',
        name: ' Daily Check ',
        prompt: ' Say hello ',
        rrule: ' FREQ=DAILY ',
        status: 'PAUSED',
      },
      storeOptions,
    )

    expect(written).toMatchObject({
      id: 'daily-check-thread-abc',
      kind: 'heartbeat',
      name: 'Daily Check',
      prompt: 'Say hello',
      rrule: 'FREQ=DAILY',
      status: 'PAUSED',
      targetThreadId: 'thread-abc',
      nextRunAtMs: null,
    })

    await expect(stat(join(automationRoot, written.id, 'memory.md'))).resolves.toBeTruthy()
    await expect(readFile(join(automationRoot, written.id, 'automation.toml'), 'utf8')).resolves.toContain('status = "PAUSED"')

    const listed = await listThreadHeartbeatAutomations(storeOptions)
    expect(Object.keys(listed)).toEqual(['thread-abc'])
    expect(listed['thread-abc']).toEqual(written)

    await expect(readThreadHeartbeatAutomation('thread-abc', storeOptions)).resolves.toEqual(written)
    await expect(deleteThreadHeartbeatAutomation(' thread-abc ', storeOptions)).resolves.toBe(true)
    await expect(readThreadHeartbeatAutomation('thread-abc', storeOptions)).resolves.toBeNull()
    await expect(stat(join(automationRoot, written.id))).rejects.toThrow()
    await expect(deleteThreadHeartbeatAutomation('thread-abc', storeOptions)).resolves.toBe(false)
  })

  it('uses thread identity in generated names so same-name automations do not collide', async () => {
    const codexHomeDir = await createCodexHome()

    const first = await writeThreadHeartbeatAutomation({
      threadId: 'thread-alpha',
      name: 'Daily Check',
      prompt: 'Alpha',
      rrule: 'FREQ=DAILY',
      status: 'ACTIVE',
    }, { codexHomeDir })
    const second = await writeThreadHeartbeatAutomation({
      threadId: 'thread-beta',
      name: 'Daily Check',
      prompt: 'Beta',
      rrule: 'FREQ=DAILY',
      status: 'ACTIVE',
    }, { codexHomeDir })

    expect(first.id).not.toBe(second.id)
    await expect(readThreadHeartbeatAutomation('thread-alpha', { codexHomeDir })).resolves.toMatchObject({ prompt: 'Alpha' })
    await expect(readThreadHeartbeatAutomation('thread-beta', { codexHomeDir })).resolves.toMatchObject({ prompt: 'Beta' })
  })

  it('keeps the first detached cron name as the folder and suffixes duplicate names', async () => {
    const codexHomeDir = await createCodexHome()
    const automationRoot = join(codexHomeDir, 'automations')

    const first = await writeNativeAutomation({
      kind: 'cron',
      threadId: null,
      name: 'Same Name',
      prompt: 'First',
      rrule: 'FREQ=DAILY',
      status: 'ACTIVE',
      runMode: 'worktree',
      cwd: '/repo/one',
    }, { codexHomeDir })
    const second = await writeNativeAutomation({
      kind: 'cron',
      threadId: null,
      name: 'Same Name',
      prompt: 'Second',
      rrule: 'FREQ=DAILY',
      status: 'ACTIVE',
      runMode: 'worktree',
      cwd: '/repo/two',
    }, { codexHomeDir })

    expect(first.id).toBe('same-name')
    expect(second.id).toMatch(/^same-name-[a-f0-9]{8}$/u)
    await expect(readFile(join(automationRoot, first.id, 'automation.toml'), 'utf8')).resolves.toContain('prompt = "First"')
    await expect(readFile(join(automationRoot, second.id, 'automation.toml'), 'utf8')).resolves.toContain('prompt = "Second"')
  })

  it('preserves unknown top-level TOML fields when updating an existing thread heartbeat automation', async () => {
    const codexHomeDir = await createCodexHome()
    const automationRoot = join(codexHomeDir, 'automations')
    const automationDir = join(automationRoot, pausedRecord.id)
    await mkdir(automationDir, { recursive: true })
    await writeFile(
      join(automationDir, 'automation.toml'),
      `${serializeAutomationToml(pausedRecord)}desktop_only = "keep me"\n`,
      'utf8',
    )

    await writeThreadHeartbeatAutomation(
      {
        threadId: pausedRecord.targetThreadId ?? '',
        name: 'Updated Daily Check',
        prompt: 'Updated prompt',
        rrule: 'FREQ=HOURLY',
        status: 'ACTIVE',
      },
      { codexHomeDir },
    )

    const rewritten = await readFile(join(automationDir, 'automation.toml'), 'utf8')
    expect(rewritten).toContain('name = "Updated Daily Check"')
    expect(rewritten).toContain('status = "ACTIVE"')
    expect(rewritten).toContain('desktop_only = "keep me"')
  })

  it('only treats a missing automations directory as empty storage', async () => {
    const codexHomeDir = await createCodexHome()
    await writeFile(join(codexHomeDir, 'automations'), 'not a directory', 'utf8')

    await expect(listNativeAutomationEntries({ codexHomeDir })).rejects.toThrow()
    await expect(listThreadHeartbeatAutomations({ codexHomeDir })).rejects.toThrow()
  })

  it('surfaces unreadable automation.toml failures instead of reporting invalid records', async () => {
    const codexHomeDir = await createCodexHome()
    const sourceDir = join(codexHomeDir, 'automations', 'unreadable')
    await mkdir(join(sourceDir, 'automation.toml'), { recursive: true })

    await expect(listNativeAutomationEntries({ codexHomeDir })).rejects.toThrow()
  })

  it('updates an existing automation in its source directory when the parsed id differs', async () => {
    const codexHomeDir = await createCodexHome()
    const automationRoot = join(codexHomeDir, 'automations')
    const sourceDir = join(automationRoot, 'safe-dir')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'automation.toml'), serializeAutomationToml({
      ...pausedRecord,
      id: 'different-id',
      targetThreadId: 'thread-safe-dir',
    }), 'utf8')

    await writeThreadHeartbeatAutomation(
      {
        threadId: 'thread-safe-dir',
        name: 'Updated Source Directory',
        prompt: 'Updated prompt',
        rrule: 'FREQ=HOURLY',
        status: 'ACTIVE',
      },
      { codexHomeDir },
    )

    const rewritten = await readFile(join(sourceDir, 'automation.toml'), 'utf8')
    expect(rewritten).toContain('name = "Updated Source Directory"')
    expect(rewritten).toContain('prompt = "Updated prompt"')
    await expect(stat(join(automationRoot, 'different-id'))).rejects.toThrow()
  })

  it('deletes an existing automation by source directory when the parsed id is unsafe', async () => {
    const codexHomeDir = await createCodexHome()
    const sessionsDir = join(codexHomeDir, 'sessions')
    await mkdir(sessionsDir, { recursive: true })
    await writeFile(join(sessionsDir, 'keep.txt'), 'do not delete', 'utf8')

    const automationRoot = join(codexHomeDir, 'automations')
    const sourceDir = join(automationRoot, 'safe-dir')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'automation.toml'), serializeAutomationToml({
      ...pausedRecord,
      id: '../sessions',
      targetThreadId: 'thread-unsafe-id',
    }), 'utf8')

    await expect(deleteThreadHeartbeatAutomation('thread-unsafe-id', { codexHomeDir })).resolves.toBe(true)
    await expect(stat(sourceDir)).rejects.toThrow()
    await expect(readFile(join(sessionsDir, 'keep.txt'), 'utf8')).resolves.toBe('do not delete')
  })

  it('lists native entries with safe source paths, invalid diagnostics, and detached heartbeat records', async () => {
    const codexHomeDir = await createCodexHome()
    const automationRoot = join(codexHomeDir, 'automations')
    const detachedDir = join(automationRoot, 'detached-dir')
    await mkdir(detachedDir, { recursive: true })
    await writeFile(join(detachedDir, 'automation.toml'), serializeAutomationToml({
      ...pausedRecord,
      id: 'detached-id',
      targetThreadId: null,
    }), 'utf8')
    const invalidDir = join(automationRoot, 'invalid-dir')
    await mkdir(invalidDir, { recursive: true })
    await writeFile(join(invalidDir, 'automation.toml'), 'id = "invalid-id"\nname = "Invalid"\n', 'utf8')

    const entries = await listNativeAutomationEntries({ codexHomeDir })

    expect(entries.records).toHaveLength(1)
    expect(entries.records[0]).toMatchObject({
      record: { id: 'detached-id', targetThreadId: null },
      sourceDirName: 'detached-dir',
      automationDirPath: detachedDir,
      automationTomlPath: join(detachedDir, 'automation.toml'),
    })
    expect(entries.diagnostics).toEqual([expect.objectContaining({
      automationId: 'invalid-dir',
      sourceDirName: 'invalid-dir',
      severity: 'error',
    })])

    const legacyList = await listThreadHeartbeatAutomations({ codexHomeDir })
    expect(legacyList).toEqual({})
  })
})

describe('legacy thread automation adapter', () => {
  it('normalizes legacy status casing and trims write payload fields', () => {
    expect(normalizeThreadAutomationStatus('PAUSED')).toBe('PAUSED')
    expect(normalizeThreadAutomationStatus('paused')).toBe('PAUSED')
    expect(normalizeThreadAutomationStatus(' paused ')).toBe('PAUSED')

    expect(parseThreadAutomationWritePayload({
      threadId: ' thread-1 ',
      name: ' Name ',
      prompt: ' Prompt ',
      rrule: ' FREQ=WEEKLY ',
      status: 'PAUSED',
    })).toEqual({
      threadId: 'thread-1',
      name: 'Name',
      prompt: 'Prompt',
      rrule: 'FREQ=WEEKLY',
      status: 'PAUSED',
    })
  })
})
