import { describe, expect, it } from 'vitest'
import { buildCronDeveloperInstructions, buildCronPrompt, buildHeartbeatPrompt } from '../prompts'

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

  it('builds the Desktop-compatible cron prompt header without a prior run', () => {
    expect(buildCronPrompt({
      automationId: 'repo-maintenance',
      automationName: 'Repo maintenance',
      automationMemoryPath: '$CODEX_HOME/automations/repo-maintenance/memory.md',
      lastRunAtIso: null,
      prompt: 'Check the repository.',
    })).toBe(`Automation: Repo maintenance
Automation ID: repo-maintenance
Automation memory: $CODEX_HOME/automations/repo-maintenance/memory.md
Last run: never

Check the repository.`)
  })

  it('formats cron last run timestamps like Desktop', () => {
    expect(buildCronPrompt({
      automationId: 'repo-maintenance',
      automationName: 'Repo maintenance',
      automationMemoryPath: '$CODEX_HOME/automations/repo-maintenance/memory.md',
      lastRunAtIso: '2026-04-30T09:00:00.000Z',
      prompt: 'Check the repository.',
    })).toContain('Last run: 2026-04-30T09:00:00.000Z (1777539600000)')
  })

  it('builds Desktop-compatible cron developer instructions with optional projectless guidance', () => {
    const instructions = buildCronDeveloperInstructions('### Projectless Chat\n- Use /tmp/output')
    expect(instructions).toContain('Response MUST end with a remark-directive block.')
    expect(instructions).toContain('Output exactly ONE inbox-item directive.')
    expect(instructions).toContain('### Projectless Chat\n- Use /tmp/output')
  })
})
