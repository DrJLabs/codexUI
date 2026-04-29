export type ArtifactEvidenceSummary = {
  id: string
  label: string
  kind: 'command' | 'test' | 'log'
  status: 'pending' | 'passed' | 'failed' | 'unknown'
  detail: string
}

export type ArtifactEvidenceModel = {
  hasOutput: boolean
  lineCount: number
  truncated: boolean
  displayText: string
  summaries: ArtifactEvidenceSummary[]
}
