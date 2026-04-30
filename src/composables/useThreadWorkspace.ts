import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  ThreadArtifactDrawerSection,
  ThreadWorkspaceDrawerSection,
  ThreadWorkspaceModel,
} from '../types/threadWorkspace'
import type { WorkspaceArtifact } from '../types/workspaceArtifacts'

type ReadableRef<T> = Ref<T> | ComputedRef<T>
type CountRef = ReadableRef<number>

const CHAT_INTEGRATION_REASON = 'Kanban chat hooks are required before automatic proposal tasks can be enabled.'
const AUTOMATIONS_FEATURE_REASON = 'Automation wiring lands after this sidebar cleanup.'

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
    const worktreeCount = threadArtifacts.filter((artifact) => artifact.kind === 'worktree').length
    const proposalCount = input.proposalCount.value
    const hasThread = Boolean(threadId)

    const disabledThreadReason = hasThread ? '' : 'Select a thread to inspect thread workspace artifacts.'
    const sections: ThreadWorkspaceDrawerSection[] = [
      createSection('thread', 'Thread', artifactCount + proposalCount, hasThread, false, disabledThreadReason),
      createSection(
        'kanban',
        'Kanban',
        0,
        hasThread,
        true,
        hasThread ? 'Kanban context wiring lands after the sidebar IA cleanup.' : disabledThreadReason,
      ),
      createSection(
        'automations',
        'Automations',
        0,
        hasThread,
        true,
        hasThread ? AUTOMATIONS_FEATURE_REASON : disabledThreadReason,
      ),
      createSection('worktrees', 'Worktrees', runCount + worktreeCount, hasThread, false, hasThread ? '' : disabledThreadReason),
      createSection('artifacts', 'Artifacts', artifactCount, true, false, ''),
      createSection(
        'actions',
        'Actions',
        input.availableActionCount?.value ?? 0,
        false,
        true,
        'Local action drawer wiring lands after the data contract is added.',
      ),
      createSection('permissions', 'Permissions', 0, false, true, 'Permission controls land in a later phase.'),
    ]

    const threadArtifactSections: ThreadArtifactDrawerSection[] = [
      createThreadArtifactSection('plan', 'Plan', planCount, hasThread, disabledThreadReason),
      createThreadArtifactSection('run', 'Run', runCount, hasThread, disabledThreadReason),
      createThreadArtifactSection('evidence', 'Evidence', evidenceCount, hasThread, disabledThreadReason),
      createThreadArtifactSection('review', 'Review', reviewCount, hasThread, disabledThreadReason),
      createThreadArtifactSection('proposals', 'Proposals', proposalCount, hasThread, disabledThreadReason),
    ]

    return {
      threadId,
      hasThread,
      artifactCount,
      activeSectionId: hasThread ? 'thread' : 'artifacts',
      sections,
      threadArtifactSections,
      deferredFollowUps: [
        {
          id: 'chat_integration_wiring',
          notePath: 'docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md',
          reason: CHAT_INTEGRATION_REASON,
        },
        {
          id: 'automations_feature',
          notePath: 'docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md',
          reason: AUTOMATIONS_FEATURE_REASON,
        },
      ],
    }
  })
}

function createSection(
  id: ThreadWorkspaceDrawerSection['id'],
  label: string,
  count: number,
  enabled: boolean,
  deferred: boolean,
  reason: string,
): ThreadWorkspaceDrawerSection {
  return {
    id,
    label,
    count: Math.max(0, Number.isFinite(count) ? count : 0),
    enabled,
    deferred,
    reason,
  }
}

function createThreadArtifactSection(
  id: ThreadArtifactDrawerSection['id'],
  label: string,
  count: number,
  enabled: boolean,
  reason: string,
): ThreadArtifactDrawerSection {
  return {
    id,
    label,
    count: Math.max(0, Number.isFinite(count) ? count : 0),
    enabled,
    reason,
  }
}
