import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { KanbanProposal, KanbanReviewPacket, KanbanRun } from '../../../types/kanban'
import type { AutomationRun } from '../../../types/automations'
import { createEmptyStateFile } from '../../kanban/migrations'
import { BUILTIN_KANBAN_RUN_PROFILES } from '../../kanban/runProfiles'
import { WorkspaceArtifactIndex } from '../artifactIndex'
import { createAutomationWorkspaceArtifactProvider } from '../adapters/automationArtifacts'
import { listKanbanWorkspaceArtifacts } from '../adapters/kanbanArtifacts'

describe('WorkspaceArtifactIndex', () => {
  it('indexes neutral Kanban artifacts without importing Kanban UI contracts', async () => {
    const state = createEmptyStateFile('/repo', '2026-04-29T00:00:00.000Z')
    const boardId = Object.keys(state.boards)[0]!
    state.tasks.task_1 = {
      id: 'task_1',
      boardId,
      title: 'Artifact task',
      description: 'Task plan text',
      status: 'review',
      priority: 'normal',
      runState: 'succeeded',
      labels: [],
      acceptanceCriteria: [],
      projectRoot: '/repo',
      cwd: '/repo',
      baseBranch: 'main',
      branchName: 'codexui/task/artifact-task',
      worktreeId: '',
      worktreePath: '/repo-worktree',
      codexThreadId: 'thread_1',
      createdBy: 'operator',
      sourceSessionKey: '',
      assignee: 'codex:auto',
      columnOrder: 0,
      currentRunId: 'run_1',
      runIds: ['run_1'],
      reviewPacketId: 'review_packet_1',
      proposalIds: ['proposal_1'],
      result: 'Completed work',
      resultAtIso: '2026-04-29T00:05:00.000Z',
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
      createdAtIso: '2026-04-29T00:00:00.000Z',
      updatedAtIso: '2026-04-29T00:05:00.000Z',
      version: 1,
    }
    state.runs.run_1 = {
      id: 'run_1',
      taskId: 'task_1',
      state: 'succeeded',
      projectRoot: '/repo',
      worktreePath: '/repo-worktree',
      branchName: 'codexui/task/artifact-task',
      threadId: 'thread_1',
      turnId: 'turn_1',
      logPath: '/tmp/run.log',
      eventsPath: '/tmp/run.ndjson',
      runProfileSnapshot: BUILTIN_KANBAN_RUN_PROFILES[1]!,
      errorMessage: '',
      createdAtIso: '2026-04-29T00:01:00.000Z',
      updatedAtIso: '2026-04-29T00:05:00.000Z',
    } satisfies KanbanRun
    state.reviewPackets.review_packet_1 = {
      id: 'review_packet_1',
      taskId: 'task_1',
      runId: 'run_1',
      packetHash: 'abc',
      generatedAtIso: '2026-04-29T00:05:00.000Z',
      baseCommit: 'base',
      headCommit: 'head',
      rawDiffPatch: 'diff --git a/a b/a',
      summary: { fileCount: 1, addedLineCount: 1, removedLineCount: 0 },
      testResults: [{ id: 'test_1', command: 'pnpm test', exitCode: 0 }],
      unresolvedProposalIds: ['proposal_1'],
    } satisfies KanbanReviewPacket
    state.proposals.proposal_1 = {
      id: 'proposal_1',
      type: 'update',
      payload: { taskId: 'task_1', patch: { title: 'Next title' } },
      sourceRunId: 'run_1',
      sourceThreadId: 'thread_1',
      proposedBy: 'codex:thread:thread_1',
      status: 'pending',
      version: 2,
      createdAtIso: '2026-04-29T00:04:00.000Z',
      updatedAtIso: '2026-04-29T00:04:00.000Z',
      resolvedAtIso: '',
      resolvedBy: '',
      reason: '',
      resultTaskId: '',
    } satisfies KanbanProposal

    const index = new WorkspaceArtifactIndex([
      { source: 'kanban', listArtifacts: async () => listKanbanWorkspaceArtifacts(state) },
    ])

    const artifacts = await index.listArtifacts({ taskId: 'task_1' })

    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      'plan',
      'run_metadata',
      'evidence',
      'worktree',
      'review_packet',
      'proposal',
    ])
    expect(await index.getArtifact('kanban:review_packet:review_packet_1')).toMatchObject({
      kind: 'review_packet',
      packetId: 'review_packet_1',
      taskId: 'task_1',
      runId: 'run_1',
      threadId: 'thread_1',
    })
    expect(await index.listArtifacts({ kind: 'proposal' })).toHaveLength(1)
  })

  it('indexes native automation run artifacts and filters by automation id', async () => {
    const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automation-artifacts-'))
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
    await writeFile(logPath, 'RESULT: FINDINGS\n', 'utf8')
    await writeFile(eventsPath, '{"event":"run.completed"}\n', 'utf8')
    await writeFile(join(runDir, 'run.json'), JSON.stringify(automationRunFixture({
      id: 'run_1',
      automationId: 'daily-check',
      automationName: 'Daily check',
      logPath,
      eventsPath,
      worktreePath: '/repo-worktree',
      branchName: 'codexui/automation/daily-check',
      reviewPacketId: null,
      proposalIds: [],
    }), null, 2), 'utf8')

    const index = new WorkspaceArtifactIndex([
      createAutomationWorkspaceArtifactProvider({ codexHomeDir }),
    ])

    const artifacts = await index.listArtifacts({ source: 'automation', automationId: 'daily-check' })

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['run_metadata', 'evidence', 'worktree'])
    expect(await index.getArtifact('automation:evidence:daily-check:run_1')).toMatchObject({
      source: 'automation',
      kind: 'evidence',
      automationId: 'daily-check',
      runId: 'run_1',
      logPath,
      eventsPath,
    })
  })
})

function automationRunFixture(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run_1',
    automationId: 'daily-check',
    automationName: 'Daily check',
    trigger: 'manual',
    runMode: 'local',
    state: 'completed_with_findings',
    promptSnapshot: 'Check the workspace.',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY' },
    dueAtIso: null,
    nextDueAtIso: null,
    runProfileId: 'workspace-coding',
    runProfileSnapshot: BUILTIN_KANBAN_RUN_PROFILES[1]!,
    targetThreadId: 'thread_1',
    cwd: '/repo',
    worktreePath: null,
    branchName: null,
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
    reviewPacketId: null,
    proposalIds: [],
    runJsonPath: '',
    eventsPath: '',
    logPath: '',
    createdAtIso: '2026-04-30T00:00:00.000Z',
    startedAtIso: '2026-04-30T00:00:01.000Z',
    completedAtIso: '2026-04-30T00:00:02.000Z',
    updatedAtIso: '2026-04-30T00:00:02.000Z',
    ...overrides,
  }
}
