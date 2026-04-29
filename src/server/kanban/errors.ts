import type { KanbanTask } from '../../types/kanban'

export class KanbanVersionConflictError extends Error {
  readonly code = 'version_conflict'
  readonly serverVersion: number
  readonly latest: KanbanTask

  constructor(latest: KanbanTask) {
    super('version_conflict')
    this.serverVersion = latest.version
    this.latest = latest
  }
}

export class KanbanNotFoundError extends Error {
  readonly code = 'not_found'

  constructor(message = 'Kanban resource not found') {
    super(message)
  }
}

export class KanbanInvalidTransitionError extends Error {
  readonly code = 'invalid_transition'

  constructor(message = 'Invalid Kanban status transition') {
    super(message)
  }
}

export class KanbanInvalidProposalError extends Error {
  readonly code = 'invalid_proposal'

  constructor(message = 'Invalid Kanban proposal') {
    super(message)
  }
}

export class KanbanRunProfilePolicyError extends Error {
  readonly code = 'run_profile_policy'

  constructor(message = 'Kanban run profile is blocked by execution policy') {
    super(message)
  }
}
