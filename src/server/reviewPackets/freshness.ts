import { createHash } from 'node:crypto'
import type { CodexRunProfile, KanbanReviewPacket } from '../../types/kanban'

export type ReviewPacketFreshnessReason =
  | 'missing_worktree_path'
  | 'task_updated'
  | 'run_changed'
  | 'base_commit_changed'
  | 'head_commit_changed'
  | 'raw_diff_changed'
  | 'test_results_changed'
  | 'unresolved_proposals_changed'
  | 'run_profile_changed'

export type ReviewPacketFingerprintInput = {
  taskUpdatedAtIso: string
  runId: string
  baseCommit: string
  headCommit: string
  rawDiffPatch: string
  testResults: Array<{ id: string; command: string; exitCode: number | null }>
  unresolvedProposalIds: string[]
  worktreePath: string
  runProfileFingerprint: string
}

export type ReviewPacketFreshnessReport = {
  isCurrent: boolean
  reasons: ReviewPacketFreshnessReason[]
}

export function createRunProfileFingerprint(profile: CodexRunProfile | null | undefined): string {
  return createStableHash(profile ?? null)
}

export function createReviewPacketFingerprint(input: ReviewPacketFingerprintInput): string {
  return createStableHash(normalizeFingerprintInput(input))
}

export function evaluateReviewPacketFreshness(
  packet: KanbanReviewPacket,
  current: ReviewPacketFingerprintInput,
): ReviewPacketFreshnessReport {
  const normalized = normalizeFingerprintInput(current)
  const reasons: ReviewPacketFreshnessReason[] = []
  if (!normalized.worktreePath) reasons.push('missing_worktree_path')
  if ((packet.sourceTaskUpdatedAtIso ?? '') !== normalized.taskUpdatedAtIso) reasons.push('task_updated')
  if (packet.runId !== normalized.runId) reasons.push('run_changed')
  if (packet.baseCommit !== normalized.baseCommit) reasons.push('base_commit_changed')
  if (packet.headCommit !== normalized.headCommit) reasons.push('head_commit_changed')
  if (packet.rawDiffPatch !== normalized.rawDiffPatch) reasons.push('raw_diff_changed')
  if (createStableHash(packet.testResults) !== createStableHash(normalized.testResults)) {
    reasons.push('test_results_changed')
  }
  if (createStableHash([...packet.unresolvedProposalIds].sort()) !== createStableHash(normalized.unresolvedProposalIds)) {
    reasons.push('unresolved_proposals_changed')
  }
  if ((packet.runProfileFingerprint ?? '') !== normalized.runProfileFingerprint) {
    reasons.push('run_profile_changed')
  }
  return { isCurrent: reasons.length === 0, reasons }
}

function normalizeFingerprintInput(input: ReviewPacketFingerprintInput): ReviewPacketFingerprintInput {
  return {
    taskUpdatedAtIso: input.taskUpdatedAtIso,
    runId: input.runId,
    baseCommit: input.baseCommit,
    headCommit: input.headCommit,
    rawDiffPatch: input.rawDiffPatch,
    worktreePath: input.worktreePath,
    runProfileFingerprint: input.runProfileFingerprint,
    testResults: input.testResults
      .map((result) => ({
        id: result.id,
        command: result.command,
        exitCode: result.exitCode,
      }))
      .sort((left, right) => left.id.localeCompare(right.id) || left.command.localeCompare(right.command)),
    unresolvedProposalIds: [...input.unresolvedProposalIds].sort(),
  }
}

function createStableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
