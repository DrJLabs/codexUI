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
  status: 'PAUSED',
  targetThreadId: 'thread-123',
  createdAtMs: 1710000000000,
  updatedAtMs: 1710000005000,
  nextRunAtMs: null,
}

describe('native automation store TOML compatibility', () => {
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
      id: 'daily-check',
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
