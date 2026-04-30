export type ThreadArtifactSectionId =
  | 'plan'
  | 'run'
  | 'evidence'
  | 'review'
  | 'proposals'

export type ThreadWorkspaceSectionId =
  | 'thread'
  | 'kanban'
  | 'automations'
  | 'worktrees'
  | 'artifacts'
  | 'actions'
  | 'permissions'

export type ThreadWorkspaceDrawerSection = {
  id: ThreadWorkspaceSectionId
  label: string
  count: number
  enabled: boolean
  deferred: boolean
  reason: string
}

export type ThreadArtifactDrawerSection = {
  id: ThreadArtifactSectionId
  label: string
  count: number
  enabled: boolean
  reason: string
}

export type ThreadWorkspaceModel = {
  threadId: string
  hasThread: boolean
  artifactCount: number
  activeSectionId: ThreadWorkspaceSectionId
  sections: ThreadWorkspaceDrawerSection[]
  threadArtifactSections: ThreadArtifactDrawerSection[]
  deferredFollowUps: Array<{
    id: 'chat_integration_wiring' | 'automations_feature'
    notePath: string
    reason: string
  }>
}
