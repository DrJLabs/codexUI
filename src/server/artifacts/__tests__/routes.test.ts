import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
})

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-artifacts-data-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-artifacts-project-'))
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
  audit?: (event: ArtifactAccessAuditEvent) => void
}) {
  const app = express()
  const index = options.artifacts
    ? new WorkspaceArtifactIndex([{ source: 'kanban', async listArtifacts() { return options.artifacts ?? [] } }])
    : undefined
  app.use('/codex-api/artifacts', createArtifactRouter({ storage: options.storage, index, audit: options.audit }))
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
