import type { AutomationTemplate } from '../../types/automations'
import {
  buildDailyRrule,
  buildWeekdaysRrule,
  buildWeeklyRrule,
} from '../../utils/automationSchedule'

type TemplateGroupId =
  | 'automation-templates-status-reports'
  | 'automation-templates-release-prep'
  | 'automation-templates-incidents-triage'
  | 'automation-templates-code-quality'
  | 'automation-templates-repo-maintenance'
  | 'automation-templates-growth-exploration'
  | 'codexui-template-aliases'

const GROUP_NAMES: Record<TemplateGroupId, string> = {
  'automation-templates-status-reports': 'Status reports',
  'automation-templates-release-prep': 'Release prep',
  'automation-templates-incidents-triage': 'Incidents & triage',
  'automation-templates-code-quality': 'Code quality',
  'automation-templates-repo-maintenance': 'Repo maintenance',
  'automation-templates-growth-exploration': 'Growth & exploration',
  'codexui-template-aliases': 'Quick aliases',
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  desktopCronTemplate({
    id: 'daily-standup',
    groupId: 'automation-templates-status-reports',
    name: 'Standup summary',
    description: "Summarize yesterday's git activity for standup.",
    prompt: `Summarize yesterday's git activity for standup.

Grounding rules:
- Anchor statements to commits/PRs/files; do not speculate about intent or future work.
- Keep it scannable and team-ready.`,
    rrule: buildWeekdaysRrule('09:00'),
    iconName: 'bubble-on-bubble',
  }),
  desktopCronTemplate({
    id: 'weekly-engineering-summary',
    groupId: 'automation-templates-status-reports',
    name: 'Weekly engineering summary',
    description: "Synthesize this week's PRs, rollouts, incidents, and reviews.",
    prompt: `Synthesize this week's PRs, rollouts, incidents, and reviews into a weekly update.

Grounding rules:
- Do not invent events; if data is missing, say that briefly.
- Prefer concrete references (PR #, incident ID, rollout note, file path) where available.`,
    rrule: buildWeeklyRrule('FR', '16:00'),
    iconName: 'figure-text-document',
  }),
  desktopCronTemplate({
    id: 'weekly-pr-summary',
    groupId: 'automation-templates-status-reports',
    name: 'Weekly PR summary',
    description: "Summarize last week's PRs by teammate and theme.",
    prompt: `Summarize last week's PRs by teammate and theme; highlight risks.

Grounding rules:
- Use PR numbers/titles when available.
- Avoid speculation about impact; stick to what the PR changed.`,
    rrule: buildWeeklyRrule('MO', '09:00'),
    iconName: 'newspaper',
  }),
  desktopCronTemplate({
    id: 'weekly-release-notes',
    groupId: 'automation-templates-release-prep',
    name: 'Weekly release notes',
    description: 'Draft release notes from merged PRs.',
    prompt: `Draft weekly release notes from merged PRs (include links when available).

Scope & grounding:
- Stay strictly within the repo history for the week; do not add extra sections beyond what the data supports.
- Use PR numbers/titles; avoid claims about impact unless supported by PR description/tests/metrics in repo.`,
    rrule: buildWeeklyRrule('FR', '09:00'),
    iconName: 'book-open',
  }),
  desktopCronTemplate({
    id: 'pre-release-check',
    groupId: 'automation-templates-release-prep',
    name: 'Pre-release check',
    description: 'Run a pre-release checklist before tagging.',
    prompt: `Before tagging, verify changelog, migrations, feature flags, and tests.

Grounding rules:
- Report ONLY what you can confirm from the repo and CI context.
- If a check cannot be verified, mark it explicitly as "Unknown."`,
    rrule: buildWeeklyRrule('TH', '13:00'),
    iconName: 'checkmark-circle',
  }),
  desktopCronTemplate({
    id: 'changelog-update',
    groupId: 'automation-templates-release-prep',
    name: 'Update changelog',
    description: "Update the changelog with this week's highlights.",
    prompt: `Update the changelog with this week's highlights and key PR links.

Constraints:
- Only include items supported by repo history.
- Keep structure simple and consistent with existing changelog format.`,
    rrule: buildWeeklyRrule('FR', '16:00'),
    iconName: 'pencil',
  }),
  desktopCronTemplate({
    id: 'nightly-ci-report',
    groupId: 'automation-templates-incidents-triage',
    name: 'Nightly CI report',
    description: 'Summarize CI failures and flaky tests.',
    prompt: `Summarize CI failures and flaky tests from the last CI window; suggest top fixes.

Grounding rules:
- Cite specific jobs, tests, error messages, or log snippets when available.
- Avoid overconfident root-cause claims; separate "observed" vs "suspected."`,
    rrule: buildDailyRrule('21:00'),
    iconName: 'radar',
  }),
  desktopCronTemplate({
    id: 'ci-monitor',
    groupId: 'automation-templates-incidents-triage',
    name: 'CI monitor',
    description: 'Check CI failures; group likely root causes.',
    prompt: `Check CI failures; group by likely root cause and suggest minimal fixes.

Grounding rules:
- Cite jobs, tests, errors, and log evidence.
- Avoid overconfident root-cause claims; label uncertain items as "Suspected."`,
    rrule: 'FREQ=HOURLY;INTERVAL=2;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR',
    iconName: 'terminal',
  }),
  desktopCronTemplate({
    id: 'issue-triage',
    groupId: 'automation-templates-incidents-triage',
    name: 'Issue triage',
    description: 'Triage new issues and suggest owners and priority.',
    prompt: `Triage new issues; suggest owner, priority, and labels.

Grounding rules:
- Base recommendations on issue content + repo context (CODEOWNERS, touched areas, prior similar issues).
- Do not guess owners without signals; if unclear, say "Owner: Unknown" and suggest a team instead.`,
    rrule: buildWeekdaysRrule('09:30'),
    iconName: 'exclamationmark-bubble',
  }),
  desktopCronTemplate({
    id: 'daily-bug-scan',
    groupId: 'automation-templates-code-quality',
    name: 'Daily bug scan',
    description: 'Scan recent commits for likely bugs and propose minimal fixes.',
    prompt: `Scan recent commits (since the last run, or last 24h) for likely bugs and propose minimal fixes.

Grounding rules:
- Use ONLY concrete repo evidence (commit SHAs, PRs, file paths, diffs, failing tests, CI signals).
- Do NOT invent bugs; if evidence is weak, say so and skip.
- Prefer the smallest safe fix; avoid refactors and unrelated cleanup.`,
    rrule: buildDailyRrule('09:00'),
    iconName: 'ladybug',
  }),
  desktopCronTemplate({
    id: 'test-gap-detection',
    groupId: 'automation-templates-code-quality',
    name: 'Test gap detection',
    description: 'Find test gaps from recent changes; create draft PRs.',
    prompt: `Identify untested paths from recent changes; add focused tests and use $yeet for draft PRs.

Constraints:
- Keep scope tight to the changed areas; avoid broad refactors.
- Prefer small, reliable tests that fail before and pass after.`,
    rrule: buildDailyRrule('15:00'),
    iconName: 'puzzle',
  }),
  desktopCronTemplate({
    id: 'performance-regression-watch',
    groupId: 'automation-templates-code-quality',
    name: 'Performance regression watch',
    description: 'Watch for performance regressions in recent changes.',
    prompt: `Compare recent changes to benchmarks or traces and flag regressions early.

Grounding rules:
- Ground claims in measurable signals (benchmarks, traces, timings, flamegraphs).
- If measurements are unavailable, state "No measurements found" rather than guessing.`,
    rrule: buildDailyRrule('09:00'),
    iconName: 'bar-chart',
  }),
  desktopCronTemplate({
    id: 'dependency-sdk-drift',
    groupId: 'automation-templates-repo-maintenance',
    name: 'Dependency and SDK drift',
    description: 'Detect dependency and SDK drift; propose alignment.',
    prompt: `Detect dependency and SDK drift and propose a minimal alignment plan.

Grounding rules:
- Cite current and target versions from the repo when possible (lockfiles, package manifests).
- Do not guess versions; if targets are unclear, propose options and label them as suggestions.`,
    rrule: buildDailyRrule('11:00'),
    iconName: 'checkmark-circle',
  }),
  desktopCronTemplate({
    id: 'dependency-sweep',
    groupId: 'automation-templates-repo-maintenance',
    name: 'Dependency sweep',
    description: 'Scan outdated dependencies and propose safe upgrades.',
    prompt: `Scan outdated dependencies; propose safe upgrades with minimal changes.

Rules:
- Prefer the smallest viable upgrade set.
- Explicitly call out breaking-change risks and required migrations.
- Do not propose upgrades without identifying current versions from the repo.`,
    rrule: 'FREQ=HOURLY;INTERVAL=720;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR,SA,SU',
    iconName: 'block-stack',
  }),
  desktopCronTemplate({
    id: 'agents-docs-sync',
    groupId: 'automation-templates-repo-maintenance',
    name: 'Update AGENTS.md',
    description: 'Update AGENTS.md with new workflows and commands.',
    prompt: `Update AGENTS.md with newly discovered workflows and commands.

Constraints:
- Keep edits minimal, accurate, and grounded in repo usage.
- Do not touch unrelated sections or auto-generated files.
- If you are unsure, prefer adding a TODO with a short note rather than inventing.`,
    rrule: buildWeeklyRrule('FR', '11:00'),
    iconName: 'text-document',
  }),
  desktopCronTemplate({
    id: 'skill-progression-map',
    groupId: 'automation-templates-growth-exploration',
    name: 'Skill progression map',
    description: 'Suggest next skills to deepen from recent PRs and reviews.',
    prompt: `From recent PRs and reviews, suggest next skills to deepen.

Grounding rules:
- Anchor each suggestion to concrete evidence (PR themes, review comments, recurring issues).
- Avoid generic advice; make each recommendation actionable and specific.`,
    rrule: buildWeeklyRrule('FR', '10:00'),
    iconName: 'hierarchy',
  }),
  desktopCronTemplate({
    id: 'performance-audit',
    groupId: 'automation-templates-growth-exploration',
    name: 'Performance audit',
    description: 'Audit performance regressions; propose fixes.',
    prompt: `Audit performance regressions and propose highest-leverage fixes.

Grounding rules:
- Ground claims in measurements/traces when available.
- If evidence is missing, state uncertainty briefly and suggest what to measure next.`,
    rrule: buildWeeklyRrule('MO', '14:00'),
    iconName: 'compass',
  }),
  {
    id: 'thread-heartbeat',
    kind: 'heartbeat',
    name: 'Thread heartbeat',
    description: 'Continuously watches one target thread on a short interval and only starts when the thread is idle.',
    prompt: 'Review this thread and report anything that needs attention.',
    schedule: { type: 'rrule', rrule: 'FREQ=MINUTELY;INTERVAL=15' },
    runMode: 'chat',
    groupId: 'codexui-template-aliases',
    groupName: GROUP_NAMES['codexui-template-aliases'],
    aliasFor: 'heartbeat-thread-check',
  },
  quickAliasTemplate({
    id: 'project-cron',
    aliasFor: 'daily-bug-scan',
    name: 'Project cron',
    description: 'Recurring project maintenance run.',
    prompt: 'Run the scheduled project check and summarize anything that needs follow-up.',
    rrule: buildDailyRrule('02:00'),
    runMode: 'local',
  }),
  quickAliasTemplate({
    id: 'worktree-check',
    aliasFor: 'performance-regression-watch',
    name: 'Worktree check',
    description: 'Recurring worktree status check.',
    prompt: 'Check the worktree status and report blockers, uncommitted changes, or failed checks.',
    rrule: 'FREQ=HOURLY;INTERVAL=6',
    runMode: 'worktree',
  }),
]

function desktopCronTemplate(input: {
  id: string
  groupId: Exclude<TemplateGroupId, 'codexui-template-aliases'>
  name: string
  description: string
  prompt: string
  rrule: string
  iconName: string
}): AutomationTemplate {
  return {
    id: input.id,
    kind: 'cron',
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    schedule: { type: 'rrule', rrule: input.rrule },
    runMode: 'worktree',
    groupId: input.groupId,
    groupName: GROUP_NAMES[input.groupId],
    iconName: input.iconName,
  }
}

function quickAliasTemplate(input: {
  id: string
  aliasFor: string
  name: string
  description: string
  prompt: string
  rrule: string
  runMode: 'local' | 'worktree'
}): AutomationTemplate {
  return {
    id: input.id,
    kind: 'cron',
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    schedule: { type: 'rrule', rrule: input.rrule },
    runMode: input.runMode,
    groupId: 'codexui-template-aliases',
    groupName: GROUP_NAMES['codexui-template-aliases'],
    aliasFor: input.aliasFor,
  }
}
