import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useArtifactEvidence } from './useArtifactEvidence'

describe('useArtifactEvidence', () => {
  it('summarizes run output and marks failed evidence from log text', () => {
    const model = useArtifactEvidence({
      runId: ref('run_1'),
      logText: ref('pnpm test\nError: failed assertion\nexit code 1'),
    })

    expect(model.value).toMatchObject({
      hasOutput: true,
      lineCount: 3,
      truncated: false,
      summaries: [
        {
          id: 'run_1:log',
          label: 'Run output',
          kind: 'log',
          status: 'failed',
          detail: '3 log lines',
        },
      ],
    })
  })

  it('does not mark successful mixed test summaries as failed', () => {
    const model = useArtifactEvidence({
      runId: ref('run_2'),
      logText: ref('Test Files  12 passed (12)\nTests  0 failed, 42 passed\nexit code 0'),
    })

    expect(model.value.summaries[0]).toMatchObject({
      id: 'run_2:log',
      status: 'passed',
      detail: '3 log lines',
    })
  })
})
