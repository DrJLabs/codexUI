import { describe, expect, it } from 'vitest'
import { buildHeartbeatPrompt } from '../prompts'

describe('automation prompt builders', () => {
  it('builds the Desktop-compatible heartbeat prompt envelope', () => {
    expect(buildHeartbeatPrompt({
      automationId: 'daily-check',
      nowIso: '2026-04-30T09:00:00.000Z',
      prompt: 'Review this thread.',
    })).toBe(`<heartbeat>
  <automation_id>daily-check</automation_id>
  <current_time_iso>2026-04-30T09:00:00.000Z</current_time_iso>
  <instructions>
Review this thread.
  </instructions>
</heartbeat>
`)
  })

  it('preserves multiline heartbeat instructions without rewriting them', () => {
    expect(buildHeartbeatPrompt({
      automationId: 'thread-heartbeat',
      nowIso: '2026-04-30T09:00:00.000Z',
      prompt: 'Line one\nLine two',
    })).toBe(`<heartbeat>
  <automation_id>thread-heartbeat</automation_id>
  <current_time_iso>2026-04-30T09:00:00.000Z</current_time_iso>
  <instructions>
Line one
Line two
  </instructions>
</heartbeat>
`)
  })

  it('matches Desktop replaceAll replacement-token behavior', () => {
    expect(buildHeartbeatPrompt({
      automationId: 'thread-heartbeat',
      nowIso: '2026-04-30T09:00:00.000Z',
      prompt: '$&',
    })).toBe(`<heartbeat>
  <automation_id>thread-heartbeat</automation_id>
  <current_time_iso>2026-04-30T09:00:00.000Z</current_time_iso>
  <instructions>
{{AUTOMATION_PROMPT}}
  </instructions>
</heartbeat>
`)
  })
})
