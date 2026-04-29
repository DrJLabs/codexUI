import { computed, type Ref } from 'vue'
import type { ArtifactEvidenceModel, ArtifactEvidenceSummary } from '../types/evidence'

const MAX_DISPLAY_CHARS = 6000

export function useArtifactEvidence(input: {
  runId: Ref<string>
  logText: Ref<string>
}) {
  return computed<ArtifactEvidenceModel>(() => {
    const rawText = input.logText.value
    const trimmedText = rawText.trim()
    const lines = trimmedText ? trimmedText.split(/\r?\n/u) : []
    const displayText = trimmedText.length > MAX_DISPLAY_CHARS
      ? `${trimmedText.slice(0, MAX_DISPLAY_CHARS)}\n... truncated ...`
      : trimmedText
    return {
      hasOutput: trimmedText.length > 0,
      lineCount: lines.length,
      truncated: trimmedText.length > MAX_DISPLAY_CHARS,
      displayText,
      summaries: buildSummaries(input.runId.value, lines),
    }
  })
}

function buildSummaries(runId: string, lines: string[]): ArtifactEvidenceSummary[] {
  const summaries: ArtifactEvidenceSummary[] = []
  const failedLine = lines.find((line) => hasFailureSignal(line))
  const passedLine = lines.find((line) => /(^|\b)(passed|success|completed successfully|exit code 0)/iu.test(line))
  summaries.push({
    id: `${runId || 'run'}:log`,
    label: 'Run output',
    kind: 'log',
    status: failedLine ? 'failed' : passedLine ? 'passed' : lines.length > 0 ? 'unknown' : 'pending',
    detail: lines.length > 0 ? `${lines.length} log line${lines.length === 1 ? '' : 's'}` : 'No output recorded',
  })
  return summaries
}

function hasFailureSignal(line: string): boolean {
  if (/(^|\b)(error|exit code [1-9])/iu.test(line)) return true
  const failedCount = /\b(\d+)\s+failed\b/iu.exec(line)
  if (failedCount) return Number(failedCount[1]) > 0
  return /(^|\b)failed\b/iu.test(line)
}
