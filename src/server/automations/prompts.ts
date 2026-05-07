const HEARTBEAT_PROMPT_TEMPLATE = `<heartbeat>
  <automation_id>{{AUTOMATION_ID}}</automation_id>
  <current_time_iso>{{NOW_ISO}}</current_time_iso>
  <instructions>
{{AUTOMATION_PROMPT}}
  </instructions>
</heartbeat>
`

type ReplaceAllString = string & {
  replaceAll(searchValue: string, replaceValue: string): string
}

export function buildHeartbeatPrompt(input: {
  automationId: string
  nowIso: string
  prompt: string
}): string {
  return replaceTemplateToken(
    replaceTemplateToken(
      replaceTemplateToken(HEARTBEAT_PROMPT_TEMPLATE, '{{AUTOMATION_ID}}', input.automationId),
      '{{NOW_ISO}}',
      input.nowIso,
    ),
    '{{AUTOMATION_PROMPT}}',
    input.prompt,
  )
}

export function buildCronPrompt(input: {
  automationId: string
  automationName: string
  automationMemoryPath: string
  lastRunAtIso: string | null
  prompt: string
}): string {
  return `Automation: ${input.automationName}
Automation ID: ${input.automationId}
Automation memory: ${input.automationMemoryPath}
Last run: ${formatCronLastRun(input.lastRunAtIso)}

${input.prompt}`
}

function replaceTemplateToken(template: string, token: string, value: string): string {
  return (template as ReplaceAllString).replaceAll(token, value)
}

function formatCronLastRun(lastRunAtIso: string | null): string {
  if (!lastRunAtIso) return 'never'
  const lastRunAtMs = Date.parse(lastRunAtIso)
  if (!Number.isFinite(lastRunAtMs)) return lastRunAtIso
  return `${new Date(lastRunAtMs).toISOString()} (${lastRunAtMs})`
}
