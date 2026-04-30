# Automations Feature High-Level Plan

## Purpose

Build a Codex Desktop-style Automations surface in CodexUI without making automation a Kanban subfeature. Automations should become a first-class product area for scheduled chats, recurring checks, heartbeat threads, run history, and triage. Kanban should remain available as an optional orchestration and review projection for automation-created work.

This plan is intentionally high level. It captures architecture, sequencing, and boundaries so implementation can resume after the right-sidebar IA is cleaned up.

## Current Repo Truth

CodexUI already has a small automation lane:

- Thread heartbeat automations are persisted under `$CODEX_HOME/automations/<automation-id>/automation.toml`.
- Each automation can have `kind`, `name`, `prompt`, `rrule`, `status`, and `target_thread_id`.
- The sidebar thread menu can add, edit, pause, and delete a thread heartbeat automation.
- The v2 message normalizer already detects heartbeat envelopes and marks automation runs in chat history.

CodexUI also has reusable Kanban-adjacent primitives:

- Run profiles and execution policy.
- A constrained app-server bridge adapter pattern.
- Managed worktrees and cleanup safeguards.
- In-memory run queue semantics.
- Hash-chained audit logging.
- Review packets.
- Proposal marker parsing and inert proposal workflows.
- Workspace artifact indexing and evidence panels.
- A deferred right-sidebar Automations section.

The current gap is product architecture: these primitives are Kanban-owned or sidebar-owned. Automations need their own type/API/UI surface and should reuse lower-level execution primitives through shared modules.

## Product Model

Automations are:

- Scheduled or manually triggered Codex runs.
- Attached to a thread, project, workspace, or explicit cwd.
- Able to run in chat, local cwd, or managed worktree mode.
- Recorded with run history, logs, artifacts, result classification, and read/archive triage.
- Allowed to project findings into Kanban only when configured.

Automations are not:

- Kanban tasks.
- A hidden property on a thread row only.
- A way to bypass execution policy, approvals, sandboxing, or review.
- A mechanism for automatic merge, push, PR creation, or dirty worktree deletion.

## Target UX

Add a first-class `Automations` route and right-sidebar section.

Primary surfaces:

- Automation list: enabled, paused, failed, unread findings, next run.
- Automation detail: definition, prompt, schedule, target, run profile, history, triage.
- Create/edit flow: template, name, prompt, target, schedule, run mode, safety profile, Kanban projection.
- Triage inbox: unread findings, failed runs, archived/no-finding runs.
- Thread integration: existing `Add automation...` menu becomes a shortcut into the shared editor with the thread preselected.
- Right sidebar: shows contextual automation links and status, not a duplicate full management UI.

## Data Model

Introduce `src/types/automations.ts` with:

```ts
type AutomationStatus = 'active' | 'paused' | 'disabled'

type AutomationRunMode = 'chat' | 'local' | 'worktree'

type AutomationSchedule =
  | { type: 'manual' }
  | { type: 'rrule'; rrule: string }
  | { type: 'interval'; everyMinutes: number }
  | { type: 'daily'; timeLocal: string }
  | { type: 'weekly'; weekday: number; timeLocal: string }

type AutomationKanbanProjection =
  | { mode: 'off' }
  | { mode: 'definition_card'; taskId?: string }
  | { mode: 'run_card'; createFor: 'every_run' | 'findings_only' | 'failures_only' }
  | { mode: 'attach_existing_task'; taskId: string }

type AutomationDefinition = {
  id: string
  kind: 'heartbeat' | 'cron' | 'scheduled_chat' | 'project_check'
  name: string
  description: string
  prompt: string
  status: AutomationStatus
  schedule: AutomationSchedule
  targetThreadId: string | null
  projectRoot: string
  cwd: string
  runMode: AutomationRunMode
  runProfileId: string
  model: string
  reasoningEffort: string
  autoArchiveNoFindings: boolean
  notifyOnFindings: boolean
  kanbanProjection: AutomationKanbanProjection
  createdAtIso: string
  updatedAtIso: string
  lastRunAtIso: string
  nextRunAtIso: string
  version: number
}

type AutomationRunState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed_with_findings'
  | 'completed_no_findings'
  | 'failed'
  | 'cancelled'
  | 'archived'

type AutomationRun = {
  id: string
  automationId: string
  trigger: 'schedule' | 'run_now' | 'manual_test' | 'thread_wake'
  state: AutomationRunState
  projectRoot: string
  cwd: string
  worktreePath: string
  branchName: string
  threadId: string
  turnId: string
  runProfileSnapshot: unknown
  promptSnapshot: string
  scheduleSnapshot: AutomationSchedule
  findings: boolean | null
  inboxTitle: string
  inboxSummary: string
  readAtIso: string
  archivedAtIso: string
  kanbanTaskId: string
  reviewPacketId: string
  logPath: string
  eventsPath: string
  createdAtIso: string
  startedAtIso: string
  completedAtIso: string
}
```

The implementation should preserve compatibility with existing `automation.toml` heartbeat records. Add CodexUI-specific metadata as a sidecar if desktop parity requires keeping the TOML shape narrow.

## Architecture

Recommended module layout:

```text
src/types/automations.ts
src/api/automationsGateway.ts
src/composables/useAutomations.ts
src/components/automations/
  AutomationsPage.vue
  AutomationList.vue
  AutomationEditor.vue
  AutomationSchedulePicker.vue
  AutomationRunModePicker.vue
  AutomationTemplateGallery.vue
  AutomationTriageInbox.vue
  AutomationRunHistory.vue
  AutomationKanbanProjectionField.vue

src/server/automations/
  nativeStore.ts
  metadataStore.ts
  schema.ts
  routes.ts
  scheduler.ts
  service.ts
  runner.ts
  resultClassifier.ts
  kanbanProjection.ts
  artifactAdapter.ts
  templates.ts

src/server/execution/
  runProfiles.ts
  codexBridgeAdapter.ts
  runQueue.ts
  auditLog.ts
  codexRunEngine.ts

src/server/workspaces/
  managedWorktreeService.ts
```

Keep compatibility wrappers around existing Kanban modules until the shared execution modules are stable.

## Sequencing

### Phase 1: Stabilize Right Sidebar IA First

Clean the right sidebar before wiring Automations deeply. The current drawer mixes first-level product areas with thread artifact tabs, which will make Automations feel bolted on.

Expected outcome:

- One first-level right-sidebar menu.
- Existing Plan/Run/Evidence/Review/Proposals content grouped under a single thread-focused area instead of duplicated as peer buttons.
- Stable homes for Kanban, Automations, Worktrees, Artifacts, Actions, and Permissions.
- `Automations` can remain empty/deferred until the backend is ready.

### Phase 2: Extract Existing Heartbeat Automation Store

Move current heartbeat automation parsing, serialization, listing, reading, writing, and deleting out of `codexAppServerBridge.ts` into `src/server/automations/nativeStore.ts`.

Keep existing endpoints working:

- `GET /codex-api/thread-automations`
- `GET /codex-api/thread-automation`
- `PUT /codex-api/thread-automation`
- `DELETE /codex-api/thread-automation`

Add unit tests for TOML round trip and existing record compatibility.

### Phase 3: Add First-Class Automations API

Mount `/codex-api/automations` before the generic bridge.

Initial API:

- `GET /codex-api/automations/state`
- `GET /codex-api/automations/templates`
- `GET /codex-api/automations`
- `GET /codex-api/automations/:automationId`
- `POST /codex-api/automations`
- `PATCH /codex-api/automations/:automationId`
- `POST /codex-api/automations/:automationId/pause`
- `POST /codex-api/automations/:automationId/resume`
- `DELETE /codex-api/automations/:automationId`

This phase should not execute scheduled work yet. It should expose definitions cleanly.

### Phase 4: Build Automations Route And Shared Editor

Add `#/automations`.

The first UI version should support:

- Listing existing heartbeat automations.
- Creating and editing a thread-attached automation.
- Pausing/resuming.
- Deleting.
- Showing the storage/source path for operational clarity.
- Reusing the same editor from the thread menu shortcut.

### Phase 5: Extract Shared Execution Primitives

Generalize Kanban-owned execution modules without breaking Kanban:

- `CodexRunProfile` moves to a shared type/module.
- Bridge adapter becomes an execution adapter.
- Queue supports generic owner keys.
- Audit log schema allows `source: 'kanban' | 'automation' | 'action'`.
- Worktree locks support owner metadata instead of only `taskId`.

Do this as compatibility-preserving extraction first. Behavior changes come later.

### Phase 6: Add Manual Run Support

Add manual `Run now` support for automations.

Supported run modes:

- `chat`: resume or start a thread and send automation prompt.
- `local`: run in configured cwd without managed worktree.
- `worktree`: create a managed worktree and run there.

Persist run records, logs, event JSONL, prompt snapshots, and run profile snapshots.

### Phase 7: Add Scheduler And Recovery

Add due-run scheduling after manual runs are stable.

Requirements:

- Persist due/queued/running state before execution.
- Recover interrupted running jobs on server startup.
- Do not rely on the in-memory queue as the source of scheduled truth.
- Enforce one active run per automation and conservative global/repo limits.
- Make missed-run behavior explicit: default to one catch-up run, not unlimited replay.

### Phase 8: Add Triage And Artifact Indexing

Add result classification:

- `completed_with_findings`
- `completed_no_findings`
- `failed`

Add unread/read/archive states. Extend workspace artifacts with source `automation` and index automation runs, logs, worktrees, review packets, and proposals.

### Phase 9: Add Kanban Projection

Automation-to-Kanban projection stays opt-in.

Projection modes:

- Off.
- One persistent definition card.
- One card per run.
- Findings-only card.
- Failures-only card.
- Attach existing task.

Automation-created Kanban cards must not auto-run. Proposal creation remains inert unless an explicit later policy enables promotion.

### Phase 10: Desktop Parity Polish

After the feature is functionally stable, compare against the installed Codex Desktop app:

- Labels and empty states.
- Create/edit flow.
- Schedule phrasing.
- Thread-attached automation wording.
- Run history and next-run display.

Document intentional differences where CodexUI is stricter for browser/mobile/headless safety.

## Safety Defaults

- Scheduled runs default to `chat` or read-only/local-safe behavior unless explicitly configured.
- `danger-full-access`, network access, and approval `never` require explicit operator selection and should not appear as casual defaults.
- No automation-created item can merge, push, open a PR, or delete a dirty worktree.
- No automation-created Kanban card can start automatically.
- Trusted remote/mobile access can create and inspect automations, but server-side scheduler execution must not depend on the browser request context that created the automation.

## Verification Strategy

Each implementation slice should include focused unit tests and a build.

Minimum test lanes:

- Native automation store TOML round trip.
- Existing thread automation endpoint compatibility.
- First-class automation route validation.
- Scheduler due calculation and startup recovery.
- Manual run lifecycle for chat/local/worktree.
- Result classifier.
- Artifact indexing for automation source.
- Kanban projection idempotency.

Manual UI checks must cover light and dark theme. Playwright screenshots are only required when explicitly requested.

## Open Questions

- Does Codex Desktop expose additional automation TOML fields that CodexUI should preserve exactly?
- Should CodexUI metadata live in `automation.toml` or a sidecar such as `codexui.json`?
- Should global Automations be available without a selected thread route, or only through the app shell route?
- What is the first supported non-heartbeat template: daily project scan, PR babysitter, changelog summary, or deployment check?
- Should no-finding runs be hidden by default or visible in run history with compact grouping?
- How should the right sidebar link a selected chat thread to one or more automations?

## Recommended Next Step

Do the right-sidebar IA cleanup first. Then implement Phases 2 through 4 as the first Automations slice, because that turns the existing heartbeat capability into a coherent product surface without taking on scheduler/execution risk immediately.
