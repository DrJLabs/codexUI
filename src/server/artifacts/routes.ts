import { stat, readFile } from 'node:fs/promises'
import express, { type Request, type Response, type Router } from 'express'
import type { KanbanProposal, KanbanReviewPacket, KanbanRun, KanbanTask } from '../../types/kanban'
import type { WorkspaceArtifact, WorkspaceArtifactKind, WorkspaceArtifactQuery, WorkspaceArtifactSource } from '../../types/workspaceArtifacts'
import type { KanbanStateFileV1 } from '../kanban/migrations'
import { classifyKanbanRemoteAccess } from '../kanban/remoteAccess'
import type { KanbanStorage } from '../kanban/storage'
import { WorkspaceArtifactIndex } from './artifactIndex'
import { createKanbanWorkspaceArtifactProvider } from './adapters/kanbanArtifacts'
import { ARTIFACT_PREVIEW_MAX_BYTES, ARTIFACT_RAW_MAX_BYTES, assertIndexedArtifactPath } from './security'

export type CreateArtifactRouterOptions = {
  storage: KanbanStorage
  index?: WorkspaceArtifactIndex
  audit?: (event: ArtifactAccessAuditEvent) => void
}

export type ArtifactAccessAuditEvent = {
  artifactId: string
  action: 'list' | 'metadata' | 'preview' | 'download' | 'raw'
  atIso: string
}

type ArtifactContent = {
  contentType: string
  filename: string
  body: string | Buffer
  encoding: 'utf8' | 'binary'
}

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>

export function createArtifactRouter(options: CreateArtifactRouterOptions): Router {
  const index = options.index ?? new WorkspaceArtifactIndex([
    createKanbanWorkspaceArtifactProvider(options.storage),
  ])
  const router = express.Router()

  router.use((req, _res, next) => {
    const access = classifyKanbanRemoteAccess(req)
    if (!access.trusted) {
      next(createHttpError(403, 'Artifact access requires trusted local or Tailscale access'))
      return
    }
    next()
  })

  router.get('/', asyncHandler(async (req, res) => {
    const artifacts = await index.listArtifacts(readArtifactQuery(req.query))
    audit(options, 'workspace-artifacts', 'list')
    res.status(200).json({ data: artifacts })
  }))

  router.get('/:artifactId', asyncHandler(async (req, res) => {
    const artifact = await readArtifact(index, readRouteParam(req.params.artifactId))
    audit(options, artifact.id, 'metadata')
    res.status(200).json({ data: artifact })
  }))

  router.get('/:artifactId/preview', asyncHandler(async (req, res) => {
    const artifact = await readArtifact(index, readRouteParam(req.params.artifactId))
    const content = await resolveCappedArtifactContent(options.storage, artifact, ARTIFACT_PREVIEW_MAX_BYTES)
    audit(options, artifact.id, 'preview')
    res.status(200).json({
      data: {
        artifact,
        preview: {
          contentType: content.contentType,
          encoding: content.encoding,
          text: typeof content.body === 'string' ? content.body : '',
          byteLength: Buffer.byteLength(content.body),
        },
      },
    })
  }))

  router.get('/:artifactId/raw', asyncHandler(async (req, res) => {
    const artifact = await readArtifact(index, readRouteParam(req.params.artifactId))
    const content = await resolveCappedArtifactContent(options.storage, artifact, ARTIFACT_RAW_MAX_BYTES)
    audit(options, artifact.id, 'raw')
    res.type(content.contentType)
    res.status(200).send(content.body)
  }))

  router.get('/:artifactId/download', asyncHandler(async (req, res) => {
    const artifact = await readArtifact(index, readRouteParam(req.params.artifactId))
    const content = await resolveCappedArtifactContent(options.storage, artifact, ARTIFACT_RAW_MAX_BYTES)
    audit(options, artifact.id, 'download')
    res.setHeader('Content-Disposition', createContentDisposition(content.filename))
    res.type(content.contentType)
    res.status(200).send(content.body)
  }))

  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500
    const message = error instanceof Error ? error.message : 'Artifact route failed'
    res.status(status).json({ error: message })
  })

  return router
}

export async function resolveArtifactContent(storage: KanbanStorage, artifact: WorkspaceArtifact, options: { maxBytes?: number } = {}): Promise<ArtifactContent> {
  const state = await storage.load()
  switch (artifact.kind) {
    case 'plan':
      return createTextContent(`${artifact.title}\n\n${readTaskPlanText(state, artifact.taskId)}`, `${artifact.id}.md`, 'text/markdown; charset=utf-8')
    case 'run_metadata':
      return createJsonContent(readRun(state, artifact.runId), `${artifact.id}.json`)
    case 'evidence':
      return await createEvidenceContent(artifact, options.maxBytes ?? ARTIFACT_RAW_MAX_BYTES)
    case 'review_packet':
      return createTextContent(readReviewPacket(state, artifact.packetId).rawDiffPatch, `${artifact.packetId}.diff`, 'text/x-diff; charset=utf-8')
    case 'proposal':
      return createJsonContent(readProposal(state, artifact.proposalId), `${artifact.proposalId}.json`)
    case 'worktree':
      return createJsonContent({
        path: artifact.worktreePath,
        branchName: artifact.branchName,
        taskId: artifact.taskId,
        runId: artifact.runId,
      }, `${artifact.id}.json`)
  }
}

async function resolveCappedArtifactContent(storage: KanbanStorage, artifact: WorkspaceArtifact, maxBytes: number): Promise<ArtifactContent> {
  const content = await resolveArtifactContent(storage, artifact, { maxBytes })
  const byteLength = Buffer.byteLength(content.body)
  if (byteLength > maxBytes) {
    throw createHttpError(413, `Artifact content exceeds ${maxBytes} bytes`)
  }
  return content
}

function asyncHandler(handler: AsyncRouteHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next)
  }
}

function readRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join('/') : value ?? ''
}

function readArtifactQuery(value: Record<string, unknown>): WorkspaceArtifactQuery {
  const query: WorkspaceArtifactQuery = {}
  const source = readSource(value.source)
  const kind = readKind(value.kind)
  const taskId = readQueryString(value.taskId)
  const runId = readQueryString(value.runId)
  const threadId = readQueryString(value.threadId)
  if (source) query.source = source
  if (kind) query.kind = kind
  if (taskId) query.taskId = taskId
  if (runId) query.runId = runId
  if (threadId) query.threadId = threadId
  return query
}

function readQueryString(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.trim() : ''
}

function readSource(value: unknown): WorkspaceArtifactSource | undefined {
  const raw = readQueryString(value)
  return raw === 'thread' || raw === 'kanban' ? raw : undefined
}

function readKind(value: unknown): WorkspaceArtifactKind | undefined {
  const raw = readQueryString(value)
  return raw === 'plan'
    || raw === 'run_metadata'
    || raw === 'evidence'
    || raw === 'review_packet'
    || raw === 'proposal'
    || raw === 'worktree'
    ? raw
    : undefined
}

async function createEvidenceContent(artifact: Extract<WorkspaceArtifact, { kind: 'evidence' }>, maxBytes: number): Promise<ArtifactContent> {
  const filePaths = Array.from(new Set([artifact.logPath, artifact.eventsPath].filter((value): value is string => Boolean(value?.trim()))))
  if (filePaths.length === 0) throw createHttpError(404, 'Artifact has no indexed evidence file')
  let blockedReason = ''
  for (const filePath of filePaths) {
    const access = assertIndexedArtifactPath(artifact, filePath)
    if (!access.allowed) {
      blockedReason ||= access.reason ?? 'Artifact access blocked'
      continue
    }
    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) continue
      if (fileStat.size > maxBytes) {
        throw createHttpError(413, `Artifact content exceeds ${maxBytes} bytes`)
      }
      return createTextContent(await readFile(filePath, 'utf8'), `${artifact.id}.log`, 'text/plain; charset=utf-8')
    } catch (error) {
      if (isHttpStatusError(error)) throw error
    }
  }
  if (blockedReason && filePaths.length === 1) throw createHttpError(403, blockedReason)
  throw createHttpError(404, 'Artifact evidence file is not readable')
}

function sanitizeDownloadFilename(filename: string): string {
  const sanitized = filename
    .replace(/["\r\n]/gu, '')
    .replace(/[:/\\]/gu, '_')
    .trim()
  return sanitized || 'artifact'
}

function createContentDisposition(filename: string): string {
  const sanitized = sanitizeDownloadFilename(filename)
  const fallback = sanitized.replace(/[^\x20-\x7E]/gu, '_') || 'artifact'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(sanitized)}`
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

async function readArtifact(index: WorkspaceArtifactIndex, artifactId: string | undefined): Promise<WorkspaceArtifact> {
  const artifact = artifactId ? await index.getArtifact(artifactId) : null
  if (!artifact) throw createHttpError(404, 'Indexed artifact not found')
  return artifact
}

function readTaskPlanText(state: KanbanStateFileV1, taskId: string | undefined): string {
  const task = taskId ? state.tasks[taskId] : null
  if (!task) return 'Task plan is unavailable.'
  const criteria = task.acceptanceCriteria.map((criterion) => `- [${criterion.checked ? 'x' : ' '}] ${criterion.text}`).join('\n')
  return [
    task.description || 'No description recorded.',
    criteria ? `\nAcceptance criteria:\n${criteria}` : '',
  ].join('\n').trim()
}

function readRun(state: KanbanStateFileV1, runId: string): KanbanRun {
  const run = state.runs[runId]
  if (!isKanbanRun(run)) throw createHttpError(404, 'Indexed run artifact is stale')
  return run
}

function readReviewPacket(state: KanbanStateFileV1, packetId: string): KanbanReviewPacket {
  const packet = state.reviewPackets[packetId]
  if (!isReviewPacket(packet)) throw createHttpError(404, 'Indexed review packet artifact is stale')
  return packet
}

function readProposal(state: KanbanStateFileV1, proposalId: string): KanbanProposal {
  const proposal = state.proposals[proposalId]
  if (!isProposal(proposal)) throw createHttpError(404, 'Indexed proposal artifact is stale')
  return proposal
}

function createTextContent(body: string, filename: string, contentType: string): ArtifactContent {
  return { body, filename, contentType, encoding: 'utf8' }
}

function createJsonContent(body: unknown, filename: string): ArtifactContent {
  return createTextContent(`${JSON.stringify(body, null, 2)}\n`, filename, 'application/json; charset=utf-8')
}

function audit(options: CreateArtifactRouterOptions, artifactId: string, action: ArtifactAccessAuditEvent['action']): void {
  options.audit?.({ artifactId, action, atIso: new Date().toISOString() })
}

function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

function isHttpStatusError(error: unknown): error is { status: number } {
  return error !== null
    && typeof error === 'object'
    && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
}

function isKanbanRun(value: unknown): value is KanbanRun {
  return isRecord(value) && typeof value.id === 'string' && typeof value.taskId === 'string'
}

function isReviewPacket(value: unknown): value is KanbanReviewPacket {
  return isRecord(value) && typeof value.id === 'string' && typeof value.rawDiffPatch === 'string'
}

function isProposal(value: unknown): value is KanbanProposal {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.type === 'create' || value.type === 'update')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
