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

describe('useThreadWorkspace', () => {
  it('separates thread and project-scoped sections for a selected thread', () => {
    const model = useThreadWorkspace({
      threadId: ref('thread_1'),
      artifacts: computed(() => [baseArtifact]),
      proposalCount: ref(2),
      activeWorktreeCount: ref(1),
      availableActionCount: ref(3),
    })

    expect(model.value.hasThread).toBe(true)
    expect(model.value.artifactCount).toBe(1)
    expect(model.value.threadSections.map((section) => section.id)).toEqual([
      'plan',
      'run',
      'evidence',
      'review',
      'proposals',
    ])
    expect(model.value.workspaceSections.map((section) => section.id)).toEqual([
      'worktrees',
      'actions',
      'permissions',
      'automations_deferred',
    ])
    expect(model.value.threadSections.find((section) => section.id === 'evidence')).toMatchObject({
      count: 1,
      enabled: true,
      deferred: false,
    })
    expect(model.value.threadSections.find((section) => section.id === 'proposals')).toMatchObject({
      count: 2,
      enabled: true,
    })
    expect(model.value.workspaceSections.find((section) => section.id === 'automations_deferred')).toMatchObject({
      enabled: false,
      deferred: true,
    })
  })

  it('keeps project-scoped sections in the model but disabled without a selected thread', () => {
    const model = useThreadWorkspace({
      threadId: ref(''),
      artifacts: computed(() => [baseArtifact]),
      proposalCount: ref(0),
      activeWorktreeCount: ref(1),
      availableActionCount: ref(0),
    })

    expect(model.value.hasThread).toBe(false)
    expect(model.value.artifactCount).toBe(0)
    expect(model.value.threadSections.every((section) => section.enabled === false)).toBe(true)
    expect(model.value.workspaceSections.find((section) => section.id === 'worktrees')).toMatchObject({
      count: 1,
      enabled: false,
      deferred: false,
    })
    expect(model.value.workspaceSections.find((section) => section.id === 'actions')).toMatchObject({
      count: 0,
      enabled: false,
      deferred: true,
    })
    expect(model.value.deferredFollowUps).toEqual([
      {
        id: 'chat_integration_wiring',
        notePath: 'docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md',
        reason: 'Kanban chat hooks are required before automatic proposal tasks can be enabled.',
      },
    ])
  })
})
