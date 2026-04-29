export type KanbanTestRunResult = {
  id: string
  command: string
  exitCode: number | null
}

export class KanbanTestRunner {
  async collectResults(): Promise<KanbanTestRunResult[]> {
    return []
  }
}
