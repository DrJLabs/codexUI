import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodexRunProfile } from '../../../types/execution'
import type { KanbanRun, KanbanTask } from '../../../types/kanban'
import type { WorkspaceArtifact } from '../../../types/workspaceArtifacts'
import { KanbanStorage } from '../../kanban/storage'
import { createArtifactRouter, type ArtifactAccessAuditEvent } from '../routes'
import { WorkspaceArtifactIndex } from '../artifactIndex'
import { ARTIFACT_PREVIEW_MAX_BYTES, ARTIFACT_RAW_MAX_BYTES } from '../security'

const servers: Server[] = []
const tempDirs: string[] = []

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true })
  }))
})

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-artifacts-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-artifacts-project-'))
  tempDirs.push(dataDir, projectRoot)
  const logPath = join(dataDir, 'run.log')
  await writeFile(logPath, 'RESULT: SUCCESS\nartifact evidence\n', 'utf8')
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const nowIso = '2026-04-29T00:00:00.000Z'
  const task = createTask(nowIso)
  const run: KanbanRun = {
    id: 'run_1',
    taskId: task.id,
    state: 'succeeded',
    projectRoot,
    worktreePath: projectRoot,
    branchName: 'codexui/task/artifacts',
    threadId: 'thread_1',
    turnId: 'turn_1',
    logPath,
    eventsPath: '',
    runProfileSnapshot: runProfile,
    errorMessage: '',
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  }
  await storage.mutate((state) => {
    state.tasks[task.id] = task
    state.runs[run.id] = run
  })
  return { storage, logPath }
}

async function createTestServer(options: {
  storage: KanbanStorage
  artifacts?: WorkspaceArtifact[]
  automations?: { codexHomeDir?: string }
  audit?: (event: ArtifactAccessAuditEvent) => void
}) {
  const app = express()
  const emptyAutomationsHome = options.automations ? null : await mkdtemp(join(tmpdir(), 'codexui-artifacts-empty-automations-'))
  if (emptyAutomationsHome) tempDirs.push(emptyAutomationsHome)
  const index = options.artifacts
    ? new WorkspaceArtifactIndex([{ source: 'kanban', async listArtifacts() { return options.artifacts ?? [] } }])
    : undefined
  app.use('/codex-api/artifacts', createArtifactRouter({
    storage: options.storage,
    automations: options.automations ?? { codexHomeDir: emptyAutomationsHome ?? undefined },
    index,
    audit: options.audit,
  }))
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  return `http://127.0.0.1:${address.port}`
}

describe('artifact routes', () => {
  it('serves previews only for indexed artifacts and audits access', async () => {
    const events: ArtifactAccessAuditEvent[] = []
    const { storage } = await createHarness()
    const baseUrl = await createTestServer({ storage, audit: (event) => events.push(event) })

    const metadata = await fetchJson<{ data: WorkspaceArtifact }>(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}`)
    const preview = await fetchJson<{ data: { preview: { text: string; contentType: string } } }>(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}/preview?path=/etc/passwd`)
    const raw = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}/raw`)

    expect(metadata.data).toMatchObject({ id: 'kanban:evidence:run_1', kind: 'evidence' })
    expect(preview.data.preview).toMatchObject({
      text: 'RESULT: SUCCESS\nartifact evidence\n',
      contentType: 'text/plain; charset=utf-8',
    })
    expect(await raw.text()).toBe('RESULT: SUCCESS\nartifact evidence\n')
    expect(events.map((event) => event.action)).toEqual(['metadata', 'preview', 'raw'])
  })

  it('lists artifacts with query filters', async () => {
    const events: ArtifactAccessAuditEvent[] = []
    const { storage } = await createHarness()
    const baseUrl = await createTestServer({ storage, audit: (event) => events.push(event) })

    const response = await fetchJson<{ data: WorkspaceArtifact[] }>(`${baseUrl}/codex-api/artifacts?threadId=thread_1&kind=evidence`)

    expect(response.data.map((artifact) => artifact.id)).toEqual(['kanban:evidence:run_1'])
    expect(events.map((event) => event.action)).toEqual(['list'])
  })

  it('rejects invalid artifact query filters', async () => {
    const { storage } = await createHarness()
    const baseUrl = await createTestServer({ storage })

    const invalidSource = await fetch(`${baseUrl}/codex-api/artifacts?source=nope`)
    const invalidKind = await fetch(`${baseUrl}/codex-api/artifacts?kind=nope`)
    const invalidAutomationId = await fetch(`${baseUrl}/codex-api/artifacts?automationId=../daily`)

    expect(invalidSource.status).toBe(400)
    await expect(invalidSource.json()).resolves.toMatchObject({ error: 'Invalid artifact source' })
    expect(invalidKind.status).toBe(400)
    await expect(invalidKind.json()).resolves.toMatchObject({ error: 'Invalid artifact kind' })
    expect(invalidAutomationId.status).toBe(400)
    await expect(invalidAutomationId.json()).resolves.toMatchObject({ error: 'Invalid automationId' })
  })

  it('lists and serves automation artifacts through indexed descriptors', async () => {
    const events: ArtifactAccessAuditEvent[] = []
    const { storage } = await createHarness()
    const { codexHomeDir, logPath } = await createAutomationHarness()
    const baseUrl = await createTestServer({
      storage,
      automations: { codexHomeDir },
      audit: (event) => events.push(event),
    })

    const list = await fetchJson<{ data: WorkspaceArtifact[] }>(`${baseUrl}/codex-api/artifacts?source=automation&automationId=daily-check`)
    const preview = await fetchJson<{ data: { preview: { text: string; contentType: string } } }>(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('automation:evidence:daily-check:run_1')}/preview?path=/etc/passwd`)
    const raw = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('automation:evidence:daily-check:run_1')}/raw?path=/etc/passwd`)
    const metadataRaw = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('automation:run:daily-check:run_1')}/raw`)

    expect(list.data.map((artifact) => artifact.id)).toEqual([
      'automation:run:daily-check:run_1',
      'automation:evidence:daily-check:run_1',
      'automation:worktree:daily-check:run_1',
      'automation:review_packet:daily-check:run_1',
      'automation:proposal:daily-check:run_1:proposal_1',
    ])
    expect(list.data.every((artifact) => artifact.source === 'automation' && artifact.automationId === 'daily-check')).toBe(true)
    expect(preview.data.preview).toMatchObject({
      text: 'RESULT: FINDINGS\nautomation evidence\n',
      contentType: 'text/plain; charset=utf-8',
    })
    expect(await raw.text()).toBe('RESULT: FINDINGS\nautomation evidence\n')
    expect(await metadataRaw.json()).toMatchObject({
      id: 'run_1',
      automationId: 'daily-check',
      logPath,
    })
    expect(events.map((event) => event.action)).toEqual(['list', 'preview', 'raw', 'raw'])
  })

  it('blocks untrusted forwarded artifact access', async () => {
    const { storage } = await createHarness()
    const baseUrl = await createTestServer({ storage })

    const response = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Artifact access requires trusted local or Tailscale access' })
  })

  it('caps preview responses independently from raw artifact downloads', async () => {
    const { storage } = await createHarness()
    await storage.mutate((state) => {
      state.reviewPackets.review_packet_large = {
        id: 'review_packet_large',
        taskId: 'task_1',
        runId: 'run_1',
        packetHash: 'hash',
        generatedAtIso: '2026-04-29T00:00:00.000Z',
        baseCommit: 'base',
        headCommit: 'head',
        rawDiffPatch: `${'x'.repeat(ARTIFACT_PREVIEW_MAX_BYTES + 1)}`,
        summary: { fileCount: 1, addedLineCount: 1, removedLineCount: 0 },
        testResults: [],
        unresolvedProposalIds: [],
      }
    })
    const artifacts: WorkspaceArtifact[] = [{
      id: 'kanban:review_packet:review_packet_large',
      kind: 'review_packet',
      source: 'kanban',
      title: 'Large review packet',
      packetId: 'review_packet_large',
      taskId: 'task_1',
      runId: 'run_1',
      threadId: 'thread_1',
    }]
    const baseUrl = await createTestServer({ storage, artifacts })

    const previewResponse = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:review_packet:review_packet_large')}/preview`)
    const rawResponse = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:review_packet:review_packet_large')}/raw`)

    expect(previewResponse.status).toBe(413)
    await expect(previewResponse.json()).resolves.toMatchObject({ error: `Artifact content exceeds ${ARTIFACT_PREVIEW_MAX_BYTES} bytes` })
    expect(rawResponse.status).toBe(200)
    expect((await rawResponse.text()).length).toBe(ARTIFACT_PREVIEW_MAX_BYTES + 1)
  })

  it('checks evidence file size before reading preview content', async () => {
    const { storage, logPath } = await createHarness()
    await writeFile(logPath, 'x'.repeat(ARTIFACT_PREVIEW_MAX_BYTES + 1), 'utf8')
    const baseUrl = await createTestServer({ storage })

    const previewResponse = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}/preview`)
    const rawResponse = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}/raw`)

    expect(previewResponse.status).toBe(413)
    await expect(previewResponse.json()).resolves.toMatchObject({ error: `Artifact content exceeds ${ARTIFACT_PREVIEW_MAX_BYTES} bytes` })
    expect(rawResponse.status).toBe(200)
    expect((await rawResponse.text()).length).toBe(ARTIFACT_PREVIEW_MAX_BYTES + 1)
  })

  it('caps raw artifact downloads at the raw response limit', async () => {
    const { storage } = await createHarness()
    await storage.mutate((state) => {
      state.reviewPackets.review_packet_huge = {
        id: 'review_packet_huge',
        taskId: 'task_1',
        runId: 'run_1',
        packetHash: 'hash',
        generatedAtIso: '2026-04-29T00:00:00.000Z',
        baseCommit: 'base',
        headCommit: 'head',
        rawDiffPatch: `${'x'.repeat(ARTIFACT_RAW_MAX_BYTES + 1)}`,
        summary: { fileCount: 1, addedLineCount: 1, removedLineCount: 0 },
        testResults: [],
        unresolvedProposalIds: [],
      }
    })
    const artifacts: WorkspaceArtifact[] = [{
      id: 'kanban:review_packet:review_packet_huge',
      kind: 'review_packet',
      source: 'kanban',
      title: 'Huge review packet',
      packetId: 'review_packet_huge',
      taskId: 'task_1',
      runId: 'run_1',
      threadId: 'thread_1',
    }]
    const baseUrl = await createTestServer({ storage, artifacts })

    const response = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:review_packet:review_packet_huge')}/raw`)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: `Artifact content exceeds ${ARTIFACT_RAW_MAX_BYTES} bytes` })
  })

  it('sanitizes artifact download filenames', async () => {
    const { storage } = await createHarness()
    const baseUrl = await createTestServer({ storage })

    const response = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:run_1')}/download`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('filename="kanban_evidence_run_1.log"')
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''kanban_evidence_run_1.log")
  })

  it('falls back to indexed event evidence when the preferred log file is missing', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'codexui-artifacts-evidence-'))
    const eventsPath = join(evidenceDir, 'events.jsonl')
    await writeFile(eventsPath, '{"event":"run.completed"}\n', 'utf8')
    const { storage } = await createHarness()
    const artifacts: WorkspaceArtifact[] = [{
      id: 'kanban:evidence:events',
      kind: 'evidence',
      source: 'kanban',
      title: 'Event evidence',
      runId: 'run_events',
      logPath: join(evidenceDir, 'missing.log'),
      eventsPath,
    }]
    const baseUrl = await createTestServer({ storage, artifacts })

    const response = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:events')}/raw`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"event":"run.completed"}\n')
  })

  it('blocks sensitive indexed evidence paths', async () => {
    const { storage } = await createHarness()
    const artifacts: WorkspaceArtifact[] = [{
      id: 'kanban:evidence:secret',
      kind: 'evidence',
      source: 'kanban',
      title: 'Secret evidence',
      runId: 'run_secret',
      logPath: '/tmp/.env',
    }]
    const baseUrl = await createTestServer({ storage, artifacts })

    const response = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:secret')}/preview`)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Artifact path is blocked by sensitive-file policy' })
  })

  it('returns not found for missing artifacts', async () => {
    const { storage } = await createHarness()
    const baseUrl = await createTestServer({ storage })

    const response = await fetch(`${baseUrl}/codex-api/artifacts/${encodeURIComponent('kanban:evidence:missing')}/preview`)

    expect(response.status).toBe(404)
  })
})

async function createAutomationHarness() {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-artifacts-automations-'))
  tempDirs.push(codexHomeDir)
  const automationDir = join(codexHomeDir, 'automations', 'daily-check')
  const runDir = join(automationDir, 'runs', 'run_1')
  const logPath = join(runDir, 'run.log')
  const eventsPath = join(runDir, 'events.jsonl')
  await mkdir(runDir, { recursive: true })
  await writeFile(join(automationDir, 'automation.toml'), [
    'version = 1',
    'id = "daily-check"',
    'kind = "heartbeat"',
    'name = "Daily check"',
    'prompt = "Check the workspace."',
    'status = "ACTIVE"',
    'rrule = "FREQ=DAILY"',
    'target_thread_id = "thread_1"',
    'created_at = 1770000000000',
    'updated_at = 1770000000000',
    '',
  ].join('\n'), 'utf8')
  await writeFile(logPath, 'RESULT: FINDINGS\nautomation evidence\n', 'utf8')
  await writeFile(eventsPath, '{"event":"run.completed"}\n', 'utf8')
  await writeFile(join(runDir, 'run.json'), JSON.stringify({
    id: 'run_1',
    automationId: 'daily-check',
    automationName: 'Daily check',
    trigger: 'manual',
    runMode: 'worktree',
    state: 'completed_with_findings',
    promptSnapshot: 'Check the workspace.',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY' },
    dueAtIso: null,
    nextDueAtIso: null,
    runProfileId: 'workspace-coding',
    runProfileSnapshot: runProfile,
    targetThreadId: 'thread_1',
    cwd: '/repo',
    worktreePath: '/repo-worktree',
    branchName: 'codexui/automation/daily-check',
    threadId: 'thread_1',
    turnId: 'turn_1',
    resultSummary: 'RESULT: FINDINGS',
    errorMessage: null,
    findings: true,
    inboxTitle: 'Findings reported',
    inboxSummary: 'RESULT: FINDINGS',
    readAtIso: null,
    archivedAtIso: null,
    kanbanTaskId: null,
    reviewPacketId: 'review_packet_1',
    proposalIds: ['proposal_1'],
    runJsonPath: join(runDir, 'run.json'),
    eventsPath,
    logPath,
    createdAtIso: '2026-04-30T00:00:00.000Z',
    startedAtIso: '2026-04-30T00:00:01.000Z',
    completedAtIso: '2026-04-30T00:00:02.000Z',
    updatedAtIso: '2026-04-30T00:00:02.000Z',
  }, null, 2), 'utf8')
  return { codexHomeDir, logPath }
}

function createTask(nowIso: string): KanbanTask {
  return {
    id: 'task_1',
    boardId: 'board_default',
    title: 'Artifact task',
    description: 'Capture evidence.',
    status: 'review',
    priority: 'normal',
    runState: 'succeeded',
    labels: [],
    acceptanceCriteria: [],
    projectRoot: '',
    cwd: '',
    baseBranch: '',
    branchName: '',
    worktreeId: '',
    worktreePath: '',
    codexThreadId: 'thread_1',
    createdBy: 'operator',
    sourceSessionKey: '',
    assignee: 'operator',
    columnOrder: 0,
    currentRunId: 'run_1',
    runIds: ['run_1'],
    reviewPacketId: '',
    proposalIds: [],
    result: '',
    resultAtIso: '',
    model: '',
    thinking: 'medium',
    runProfileId: 'workspace-coding',
    dueAtIso: '',
    estimateMinutes: null,
    actualMinutes: null,
    feedback: [],
    blockedReason: '',
    errorMessage: '',
    archived: false,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    version: 1,
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  return await response.json() as T
}
