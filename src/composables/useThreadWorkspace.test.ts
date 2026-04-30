import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import type { WorkspaceArtifact } from '../types/workspaceArtifacts'
import { useThreadWorkspace } from './useThreadWorkspace'

const baseArtifact = {
  id: 'kanban:evidence:run_1',
  source: 'kanban',
  kind: 'evidence',
  title: 'Run evidence',
  threadId: 'thread_1',
  runId: 'run_1',
} satisfies WorkspaceArtifact

const runArtifact = {
  id: 'kanban:run:run_1',
  source: 'kanban',
  kind: 'run_metadata',
  title: 'Run metadata',
  threadId: 'thread_1',
  runId: 'run_1',
} satisfies WorkspaceArtifact

describe('useThreadWorkspace', () => {
  it('builds first-level workspace sections and nested thread artifact sections for a selected thread', () => {
    const model = useThreadWorkspace({
      threadId: ref('thread_1'),
      artifacts: computed(() => [baseArtifact, runArtifact]),
      proposalCount: ref(2),
      activeWorktreeCount: ref(3),
      availableActionCount: ref(3),
    })

    expect(model.value.hasThread).toBe(true)
    expect(model.value.artifactCount).toBe(2)
    expect(model.value.activeSectionId).toBe('thread')
    expect(model.value.sections.map((section) => section.id)).toEqual([
      'thread',
      'kanban',
      'automations',
      'worktrees',
      'artifacts',
      'actions',
      'permissions',
    ])
    expect(model.value.threadArtifactSections.map((section) => section.id)).toEqual([
      'plan',
      'run',
      'evidence',
      'review',
      'proposals',
    ])
    expect(model.value.sections.find((section) => section.id === 'thread')).toMatchObject({
      count: 4,
      enabled: true,
      deferred: false,
    })
    expect(model.value.sections.find((section) => section.id === 'worktrees')).toMatchObject({
      count: 3,
      enabled: true,
    })
    expect(model.value.threadArtifactSections.find((section) => section.id === 'evidence')).toMatchObject({
      count: 1,
      enabled: true,
    })
    expect(model.value.threadArtifactSections.find((section) => section.id === 'proposals')).toMatchObject({
      count: 2,
      enabled: true,
    })
    expect(model.value.sections.find((section) => section.id === 'automations')).toMatchObject({
      enabled: true,
      deferred: true,
    })
  })

  it('keeps artifacts enabled and contextual sections disabled without a selected thread', () => {
    const model = useThreadWorkspace({
      threadId: ref(''),
      artifacts: computed(() => [baseArtifact]),
      proposalCount: ref(0),
      activeWorktreeCount: ref(1),
      availableActionCount: ref(0),
    })

    expect(model.value.hasThread).toBe(false)
    expect(model.value.artifactCount).toBe(0)
    expect(model.value.activeSectionId).toBe('artifacts')
    expect(model.value.sections.find((section) => section.id === 'artifacts')).toMatchObject({
      count: 0,
      enabled: true,
      deferred: false,
    })
    expect(model.value.sections.find((section) => section.id === 'thread')).toMatchObject({
      count: 0,
      enabled: false,
      deferred: false,
    })
    expect(model.value.sections.find((section) => section.id === 'kanban')).toMatchObject({
      enabled: false,
      deferred: true,
    })
    expect(model.value.sections.find((section) => section.id === 'automations')).toMatchObject({
      enabled: false,
      deferred: true,
    })
    expect(model.value.sections.find((section) => section.id === 'worktrees')).toMatchObject({
      count: 0,
      enabled: false,
      deferred: false,
    })
    expect(model.value.sections.find((section) => section.id === 'actions')).toMatchObject({
      count: 0,
      enabled: false,
      deferred: true,
    })
    expect(model.value.sections.find((section) => section.id === 'permissions')).toMatchObject({
      count: 0,
      enabled: false,
      deferred: true,
    })
    expect(model.value.threadArtifactSections.every((section) => section.enabled === false)).toBe(true)
    expect(model.value.deferredFollowUps).toEqual([
      {
        id: 'chat_integration_wiring',
        notePath: 'docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md',
        reason: 'Kanban chat hooks are required before automatic proposal tasks can be enabled.',
      },
      {
        id: 'automations_feature',
        notePath: 'docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md',
        reason: 'Automation wiring lands after this sidebar cleanup.',
      },
    ])
  })
})
