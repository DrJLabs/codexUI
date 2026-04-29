export type ThreadWorkspaceSectionId =
  | 'plan'
  | 'run'
  | 'evidence'
  | 'review'
  | 'proposals'

export type WorkspaceSectionId =
  | 'worktrees'
  | 'actions'
  | 'permissions'
  | 'automations_deferred'

export type ThreadWorkspaceDrawerSection = {
  id: ThreadWorkspaceSectionId | WorkspaceSectionId
  scope: 'thread' | 'workspace'
  label: string
  count: number
  enabled: boolean
  deferred: boolean
  reason: string
}

export type ThreadWorkspaceModel = {
  threadId: string
  hasThread: boolean
  artifactCount: number
  activeSectionId: ThreadWorkspaceDrawerSection['id']
  threadSections: ThreadWorkspaceDrawerSection[]
  workspaceSections: ThreadWorkspaceDrawerSection[]
  deferredFollowUps: Array<{
    id: 'chat_integration_wiring'
    notePath: string
    reason: string
  }>
}
