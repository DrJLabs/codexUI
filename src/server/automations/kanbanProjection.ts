import type { AutomationDefinition, AutomationRun } from '../../types/automations'
import type { KanbanTask, KanbanTaskLabel } from '../../types/kanban'
import type { KanbanStorage } from '../kanban/storage'
import type { KanbanTaskService } from '../kanban/taskService'
import { KanbanNotFoundError } from '../kanban/errors'
import { AutomationValidationError } from './errors'

export type AutomationKanbanProjectionServiceOptions = {
  storage: KanbanStorage
  taskService: KanbanTaskService
}

export class AutomationKanbanProjectionService {
  private readonly taskService: KanbanTaskService

  constructor(options: AutomationKanbanProjectionServiceOptions) {
    this.taskService = options.taskService
  }

  async projectDefinition(input: { definition: AutomationDefinition }): Promise<{ taskId: string | null }> {
    const projection = input.definition.kanbanProjection
    if (projection.mode === 'off' || projection.mode === 'run_card') return { taskId: null }
    if (projection.mode === 'attach_existing_task') {
      await this.validateTask(projection.taskId)
      return { taskId: projection.taskId }
    }

    const idempotencyLabel = definitionLabel(input.definition.id)
    const task = await this.taskService.createTaskIfNoActiveLabel(idempotencyLabel, {
      title: `Automation: ${input.definition.name}`,
      description: createDefinitionDescription(input.definition),
      labels: [createProjectionLabel(idempotencyLabel)],
    })
    return { taskId: task.id }
  }

  async projectRun(input: { definition: AutomationDefinition; run: AutomationRun }): Promise<{ taskId: string | null }> {
    const projection = input.definition.kanbanProjection
    if (projection.mode !== 'run_card') return { taskId: null }
    if (!shouldProjectRun(projection.createFor, input.run)) return { taskId: null }

    const idempotencyLabel = runLabel(input.definition.id, input.run.id)
    const task = await this.taskService.createTaskIfNoActiveLabel(idempotencyLabel, {
      title: `Automation finding: ${input.definition.name}`,
      description: createRunDescription(input.definition, input.run),
      labels: [createProjectionLabel(idempotencyLabel)],
    })
    return { taskId: task.id }
  }

  async validateTask(taskId: string): Promise<void> {
    let task: KanbanTask
    try {
      task = await this.taskService.getTask(taskId)
    } catch (error) {
      if (!(error instanceof KanbanNotFoundError)) throw error
      throw new AutomationValidationError('Kanban projection task not found')
    }
    if (task.archived) throw new AutomationValidationError('Kanban projection task is archived')
  }
}

function shouldProjectRun(createFor: 'every_run' | 'findings_only' | 'failures_only', run: AutomationRun): boolean {
  if (createFor === 'every_run') {
    return run.state === 'completed_with_findings' || run.state === 'completed_no_findings' || run.state === 'failed'
  }
  if (createFor === 'findings_only') return run.state === 'completed_with_findings'
  return run.state === 'failed'
}

function definitionLabel(automationId: string): string {
  return `automation:${automationId}:definition`
}

function runLabel(automationId: string, runId: string): string {
  return `automation:${automationId}:run:${runId}`
}

function createProjectionLabel(name: string): KanbanTaskLabel {
  return {
    id: labelIdFromName(name),
    name,
    color: '#2563eb',
  }
}

function labelIdFromName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return `label_${normalized || 'automation'}`
}

function createDefinitionDescription(definition: AutomationDefinition): string {
  return [
    `Automation id: ${definition.id}`,
    `Run state: ${definition.status}`,
  ].join('\n')
}

function createRunDescription(definition: AutomationDefinition, run: AutomationRun): string {
  return [
    `Automation id: ${definition.id}`,
    `Run id: ${run.id}`,
    `Run state: ${run.state}`,
    `Inbox title: ${run.inboxTitle}`,
    `Inbox summary: ${run.inboxSummary}`,
    run.logPath ? `Log path: ${run.logPath}` : null,
  ].filter(Boolean).join('\n')
}
