import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import { KanbanStorage } from '../storage'
import { KanbanProposalService } from '../proposalService'
import { KanbanTaskService } from '../taskService'

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionEnabled: false,
  requireTrustedAccessForExecution: true,
  allowTailscaleAccess: true,
  requireLoopbackForExecution: false,
  disableExecutionWhenRemote: false,
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
  allowDangerFullAccess: false,
  allowApprovalNever: false,
  allowAcceptForSession: false,
  useThreadShellCommand: false,
  maxGlobalActiveRuns: 1,
  maxActiveRunsPerRepo: 1,
  maxActiveRunsPerTask: 1,
}

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-proposal-service-test-'))
  const projectRoot = join(dataDir, 'project')
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const taskService = new KanbanTaskService({ storage, projectRoot, policy })
  const proposalService = new KanbanProposalService({ storage, taskService })
  return { proposalService, taskService }
}

describe('KanbanProposalService', () => {
  it('creates V2 create proposals and creates a task when approved', async () => {
    const { proposalService, taskService } = await createHarness()

    const proposal = await proposalService.createProposal({
      type: 'create',
      payload: {
        title: 'Follow-up task',
        description: 'Check mobile layout',
        priority: 'high',
        labels: [{ id: 'label_ui', name: 'ui', color: 'blue' }],
      },
      sourceRunId: 'run_1',
      sourceThreadId: 'thread_1',
      proposedBy: 'codex:thread:thread_1',
    })
    const approved = await proposalService.approveProposal(proposal.id, {
      resolvedBy: 'operator',
      reason: 'Looks good',
    })

    expect(proposal).toMatchObject({
      type: 'create',
      payload: {
        title: 'Follow-up task',
        description: 'Check mobile layout',
        priority: 'high',
      },
      status: 'pending',
      version: 2,
      sourceRunId: 'run_1',
      sourceThreadId: 'thread_1',
      proposedBy: 'codex:thread:thread_1',
      resolvedAtIso: '',
      resolvedBy: '',
      reason: '',
      resultTaskId: '',
    })
    expect(approved.status).toBe('approved')
    expect(approved.resolvedBy).toBe('operator')
    expect(approved.reason).toBe('Looks good')
    expect(approved.resolvedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(approved.resultTaskId).toMatch(/^task_/u)
    await expect(taskService.getTask(approved.resultTaskId)).resolves.toMatchObject({
      title: 'Follow-up task',
      description: 'Check mobile layout',
      priority: 'high',
      labels: [{ id: 'label_ui', name: 'ui', color: 'blue' }],
    })
  })

  it('applies update proposal patches when approved', async () => {
    const { proposalService, taskService } = await createHarness()
    const task = await taskService.createTask({ title: 'Needs credentials' })
    const proposal = await proposalService.createProposal({
      type: 'update',
      payload: {
        taskId: task.id,
        patch: { blockedReason: 'Needs credentials' },
      },
      sourceRunId: 'run_2',
      sourceThreadId: 'thread_2',
      proposedBy: 'codex:auto',
    })

    const approved = await proposalService.approveProposal(proposal.id, {
      resolvedBy: 'operator',
    })

    expect(approved).toMatchObject({
      status: 'approved',
      resultTaskId: task.id,
    })
    await expect(taskService.getTask(task.id)).resolves.toMatchObject({
      blockedReason: 'Needs credentials',
      version: task.version + 1,
    })
  })

  it('rejects update proposals without a recognized patch field', async () => {
    const { proposalService, taskService } = await createHarness()
    const task = await taskService.createTask({ title: 'No-op target' })

    await expect(proposalService.createProposal({
      type: 'update',
      payload: {
        taskId: task.id,
        patch: { unknown: 'ignored' },
      },
      sourceRunId: 'run_noop',
      sourceThreadId: 'thread_noop',
      proposedBy: 'operator',
    } as never)).rejects.toThrow('Kanban proposal patch must include at least one update field')
  })

  it('serializes concurrent approvals so side effects run once', async () => {
    const { proposalService, taskService } = await createHarness()
    const proposal = await proposalService.createProposal({
      type: 'create',
      payload: { title: 'Approve once' },
      sourceRunId: 'run_once',
      sourceThreadId: 'thread_once',
      proposedBy: 'operator',
    })

    const results = await Promise.allSettled([
      proposalService.approveProposal(proposal.id, { resolvedBy: 'operator' }),
      proposalService.approveProposal(proposal.id, { resolvedBy: 'operator' }),
    ])
    const tasks = await taskService.listTasks({ q: 'Approve once', limit: 20, offset: 0 })

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(tasks.items).toHaveLength(1)
  })

  it('records rejection metadata and filters proposal lists by status', async () => {
    const { proposalService } = await createHarness()
    const rejectedProposal = await proposalService.createProposal({
      type: 'create',
      payload: { title: 'Reject me' },
      sourceRunId: 'run_3',
      sourceThreadId: 'thread_3',
      proposedBy: 'operator',
    })
    await proposalService.createProposal({
      type: 'create',
      payload: { title: 'Keep pending' },
      sourceRunId: 'run_4',
      sourceThreadId: 'thread_4',
      proposedBy: 'operator',
    })

    const rejected = await proposalService.rejectProposal(rejectedProposal.id, {
      resolvedBy: 'operator',
      reason: 'Not needed',
    })
    const pending = await proposalService.listProposals({ status: 'pending' })
    const rejectedList = await proposalService.listProposals({ status: 'rejected' })

    expect(rejected.status).toBe('rejected')
    expect(rejected.resolvedBy).toBe('operator')
    expect(rejected.reason).toBe('Not needed')
    expect(rejected.resolvedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(pending.map((proposal) => proposal.type === 'create' ? proposal.payload.title : '')).toEqual(['Keep pending'])
    expect(rejectedList.map((proposal) => proposal.id)).toEqual([rejectedProposal.id])
  })

  it('auto-approves marker-created proposals when proposalPolicy is auto', async () => {
    const { proposalService, taskService } = await createHarness()
    await taskService.updateConfig({ proposalPolicy: 'auto' })

    const result = await proposalService.createProposalsFromMarkers({
      text: `Complete.

\`\`\`kanban:create
{"title":"Auto marker task","priority":"high"}
\`\`\``,
      sourceRunId: 'run_auto',
      sourceThreadId: 'thread_auto',
      proposedBy: 'codex:auto',
    })

    expect(result.cleanText).toBe('Complete.')
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]).toMatchObject({
      type: 'create',
      status: 'approved',
      resultTaskId: expect.stringMatching(/^task_/u),
    })
    await expect(taskService.getTask(result.proposals[0]!.resultTaskId)).resolves.toMatchObject({
      title: 'Auto marker task',
      priority: 'high',
    })
  })
})
