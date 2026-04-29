import { computed, type ComputedRef, type Ref } from 'vue'
import type { ThreadWorkspaceDrawerSection, ThreadWorkspaceModel } from '../types/threadWorkspace'
import type { WorkspaceArtifact } from '../types/workspaceArtifacts'

type ReadableRef<T> = Ref<T> | ComputedRef<T>
type CountRef = ReadableRef<number>

const CHAT_INTEGRATION_REASON = 'Kanban chat hooks are required before automatic proposal tasks can be enabled.'

export function useThreadWorkspace(input: {
  threadId: ReadableRef<string>
  artifacts: ReadableRef<WorkspaceArtifact[]>
  proposalCount: CountRef
  activeWorktreeCount: CountRef
  availableActionCount?: CountRef
}) {
  return computed<ThreadWorkspaceModel>(() => {
    const threadId = input.threadId.value.trim()
    const threadArtifacts = threadId
      ? input.artifacts.value.filter((artifact) => artifact.threadId === threadId)
      : []
    const artifactCount = threadArtifacts.length
    const evidenceCount = threadArtifacts.filter((artifact) => artifact.kind === 'evidence').length
    const reviewCount = threadArtifacts.filter((artifact) => artifact.kind === 'review_packet').length
    const runCount = threadArtifacts.filter((artifact) => artifact.kind === 'run_metadata').length
    const planCount = threadArtifacts.filter((artifact) => artifact.kind === 'plan').length
    const hasThread = Boolean(threadId)

    const disabledThreadReason = hasThread ? '' : 'Select a thread to inspect thread workspace artifacts.'
    const threadSections: ThreadWorkspaceDrawerSection[] = [
      createSection('plan', 'thread', 'Plan', planCount, hasThread, false, disabledThreadReason),
      createSection('run', 'thread', 'Run', runCount, hasThread, false, disabledThreadReason),
      createSection('evidence', 'thread', 'Evidence', evidenceCount, hasThread, false, disabledThreadReason),
      createSection('review', 'thread', 'Review', reviewCount, hasThread, false, disabledThreadReason),
      createSection('proposals', 'thread', 'Proposals', input.proposalCount.value, hasThread, false, disabledThreadReason),
    ]

    const workspaceSections: ThreadWorkspaceDrawerSection[] = [
      createSection('worktrees', 'workspace', 'Worktrees', input.activeWorktreeCount.value, hasThread, false, hasThread ? '' : 'Open a thread to inspect recorded worktree artifacts.'),
      createSection('actions', 'workspace', 'Actions', input.availableActionCount?.value ?? 0, false, true, 'Local action drawer wiring lands after the data contract is added.'),
      createSection('permissions', 'workspace', 'Permissions', 0, false, true, 'Permission controls land in a later phase.'),
      createSection(
        'automations_deferred',
        'workspace',
        'Automations',
        0,
        false,
        true,
        CHAT_INTEGRATION_REASON,
      ),
    ]

    return {
      threadId,
      hasThread,
      artifactCount,
      activeSectionId: hasThread ? 'evidence' : 'worktrees',
      threadSections,
      workspaceSections,
      deferredFollowUps: [
        {
          id: 'chat_integration_wiring',
          notePath: 'docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md',
          reason: CHAT_INTEGRATION_REASON,
        },
      ],
    }
  })
}

function createSection(
  id: ThreadWorkspaceDrawerSection['id'],
  scope: ThreadWorkspaceDrawerSection['scope'],
  label: string,
  count: number,
  enabled: boolean,
  deferred: boolean,
  reason: string,
): ThreadWorkspaceDrawerSection {
  return {
    id,
    scope,
    label,
    count: Math.max(0, Number.isFinite(count) ? count : 0),
    enabled,
    deferred,
    reason,
  }
}
