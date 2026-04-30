# Automations Feature High-Level Plan

## Purpose

Build a Codex Desktop-style Automations surface in CodexUI without making automation a Kanban subfeature. Automations should become a first-class product area for scheduled chats, recurring checks, heartbeat threads, run history, and triage. Kanban should remain available as an optional orchestration and review projection for automation-created work.

This plan is intentionally high level. It captures architecture, sequencing, and boundaries so implementation can resume after the right-sidebar IA is cleaned up.

Detailed Phase 7 scheduler and recovery work is tracked in [Automations Phase 7 Scheduler And Recovery Implementation Plan](./2026-04-30-automations-phase-7-scheduler-and-recovery.md).

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

## Review Adjustments

This plan has been reviewed against the current repo state on 2026-04-30. The direction is sound, but implementation should proceed with these corrections:

- Treat existing `$CODEX_HOME/automations/<automation-id>/automation.toml` files as a compatibility boundary. The current implementation parses a narrow top-level key/value subset and rewrites only known fields, so extraction must not drop unknown Desktop/runtime fields if they exist.
- Use a CodexUI sidecar, defaulting to `codexui.json`, for first-class metadata until Desktop parity proves additional fields can safely live in `automation.toml`.
- Preserve legacy status casing at the legacy endpoint boundary: existing thread automation APIs expose `ACTIVE` and `PAUSED`; first-class Automations can use lower-case internal status values only through an explicit adapter.
- Do not require project/workspace/cwd/run-profile fields for legacy heartbeat automations in the first API slice. Those fields should be nullable or sidecar-derived until execution modes beyond thread chat are implemented.
- Mount the Automations router in `src/server/httpServer.ts` beside Kanban and artifacts, before the generic Codex bridge, with the same trusted-access and CSRF posture for mutations.
- Extend shared artifact/source contracts deliberately when automation artifacts arrive. `WorkspaceArtifactSource` currently only allows `thread` and `kanban`.
- Extract Kanban execution primitives one at a time. A broad move of runner, audit, queue, worktree, proposal, and review code in one phase is too likely to regress Kanban.

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

type LegacyThreadAutomationStatus = 'ACTIVE' | 'PAUSED'

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
  description: string | null
  prompt: string
  status: AutomationStatus
  legacyStatus?: LegacyThreadAutomationStatus
  schedule: AutomationSchedule
  targetThreadId: string | null
  projectRoot: string | null
  cwd: string | null
  runMode: AutomationRunMode | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
  autoArchiveNoFindings: boolean
  notifyOnFindings: boolean
  kanbanProjection: AutomationKanbanProjection
  createdAtIso: string
  updatedAtIso: string
  lastRunAtIso: string | null
  nextRunAtIso: string | null
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
  worktreePath: string | null
  branchName: string | null
  threadId: string | null
  turnId: string | null
  runProfileSnapshot: unknown | null
  promptSnapshot: string
  scheduleSnapshot: AutomationSchedule
  findings: boolean | null
  inboxTitle: string
  inboxSummary: string
  readAtIso: string | null
  archivedAtIso: string | null
  kanbanTaskId: string | null
  reviewPacketId: string | null
  logPath: string
  eventsPath: string
  createdAtIso: string
  startedAtIso: string | null
  completedAtIso: string | null
}
```

Compatibility rules:

- Existing heartbeat records map `rrule` to `schedule: { type: 'rrule' }`.
- Existing heartbeat records map `ACTIVE` and `PAUSED` to internal `active` and `paused`, and map back to uppercase for the legacy thread endpoints.
- `disabled` is a first-class CodexUI state and should not be written into legacy `automation.toml` unless Desktop/runtime parity proves it is accepted.
- `projectRoot`, `cwd`, `runMode`, `runProfileId`, `model`, and `reasoningEffort` are nullable for imported heartbeat records until a sidecar or later execution phase supplies them.
- CodexUI-specific metadata should live in `codexui.json` by default. Only move metadata into `automation.toml` after a parity check against installed Desktop/runtime behavior.

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
  legacyAdapter.ts
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

Mounting and boundaries:

- Add `createAutomationsRouter()` and mount it in `src/server/httpServer.ts` before `app.use(bridge)`, matching the Kanban/artifacts route ownership pattern.
- Keep existing `/codex-api/thread-automation*` endpoints working while their implementation delegates to `nativeStore.ts` through `legacyAdapter.ts`.
- Keep compatibility wrappers around existing Kanban modules until the shared execution modules are stable.
- Do not import Kanban UI contracts into the Automations server modules. Shared execution types should move to neutral modules before Automations depends on them.

## Sequencing

### Phase 0: Parity And Contract Discovery

Before changing storage behavior, capture the exact contract.

Expected outcome:

- A code map of the current thread automation path:
  - `src/types/codex.ts`
  - `src/api/codexGateway.ts`
  - `src/components/sidebar/SidebarThreadTree.vue`
  - `src/server/codexAppServerBridge.ts`
  - `tests.md`
- A sample inventory of existing `$CODEX_HOME/automations/*/automation.toml` records, with secrets/prompts redacted in notes if needed.
- A Desktop/runtime parity note. The local Codex reference snapshot does not currently document an automation TOML schema, so do not infer unsupported TOML fields from UI wording alone.
- A migration decision recorded in this plan or a follow-up note: sidecar-first unless parity proves TOML metadata is safe.

Phase 0 contract discovery artifact: [`../notes/2026-04-30-automations-phase-0-contract-discovery.md`](../notes/2026-04-30-automations-phase-0-contract-discovery.md).

### Phase 1: Stabilize Right Sidebar IA First

Clean the right sidebar before wiring Automations deeply. The current drawer mixes first-level product areas with thread artifact tabs, which will make Automations feel bolted on.

Expected outcome:

- One first-level right-sidebar menu.
- Existing Plan/Run/Evidence/Review/Proposals content grouped under a single thread-focused area instead of duplicated as peer buttons.
- Stable homes for Kanban, Automations, Worktrees, Artifacts, Actions, and Permissions.
- `Automations` can remain empty/deferred until the backend is ready.

Phase 1 implementation plan: [`2026-04-30-automations-phase-1-right-sidebar-ia.md`](2026-04-30-automations-phase-1-right-sidebar-ia.md).

### Phase 2: Extract Existing Heartbeat Automation Store

Move current heartbeat automation parsing, serialization, listing, reading, writing, and deleting out of `codexAppServerBridge.ts` into `src/server/automations/nativeStore.ts`.

Add `src/server/automations/legacyAdapter.ts` for status casing and field-name translation between native records, first-class definitions, and legacy thread endpoint responses.

Phase 2 implementation plan: [`2026-04-30-automations-phase-2-heartbeat-store-extraction.md`](2026-04-30-automations-phase-2-heartbeat-store-extraction.md).

Keep existing endpoints working:

- `GET /codex-api/thread-automations`
- `GET /codex-api/thread-automation`
- `PUT /codex-api/thread-automation`
- `DELETE /codex-api/thread-automation`

Add unit tests for:

- TOML round trip of existing CodexUI records.
- Existing record compatibility with `ACTIVE` and `PAUSED`.
- Unknown top-level TOML fields are preserved or left untouched by metadata-only operations.
- Invalid or partial automation records are skipped without breaking listing.
- Existing legacy endpoint response shape remains unchanged.

### Phase 3: Add First-Class Automations API

Mount `/codex-api/automations` before the generic bridge in `src/server/httpServer.ts`.

Initial API:

- `GET /codex-api/automations/health`
- `GET /codex-api/automations/csrf`
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

Phase 3 implementation plan: [`2026-04-30-automations-phase-3-first-class-api.md`](2026-04-30-automations-phase-3-first-class-api.md).

Requirements:

- Mutating routes require trusted access and CSRF, following the Kanban router pattern.
- `state` includes storage root, source counts, feature flags, and any invalid-record diagnostics safe to expose.
- `POST` and `PATCH` validate schedules, target thread IDs, nullable execution fields, and sidecar-only fields.
- Deletion behavior distinguishes deleting the CodexUI sidecar from removing the underlying native automation folder. The default UI action for imported heartbeat records should preserve the existing legacy remove behavior, but the API should make destructive folder removal explicit.

### Phase 4: Build Automations Route And Shared Editor

Add `#/automations`.

The first UI version should support:

- Listing existing heartbeat automations.
- Creating and editing a thread-attached automation.
- Pausing/resuming.
- Deleting.
- Showing the storage/source path for operational clarity.
- Reusing the same editor from the thread menu shortcut.
- Wiring the existing primary-nav `Automations` row instead of adding another entry point.
- Keeping the current thread menu dialog as a fallback until the shared editor can reliably open with the selected thread prefilled.

Phase 4 implementation plan: [`2026-04-30-automations-phase-4-route-and-editor.md`](2026-04-30-automations-phase-4-route-and-editor.md).

### Phase 5: Extract Shared Execution Primitives

Generalize Kanban-owned execution modules without breaking Kanban:

- Move `CodexRunProfile` and run profile normalization first.
- Move bridge adapter shape second, keeping Kanban wrapper tests green.
- Generalize queue owner keys after run profiles and adapter are stable.
- Generalize audit logging with a new schema version that includes `source: 'kanban' | 'automation' | 'action'`; do not mutate existing Kanban hash-chain records in place.
- Generalize worktree locks with owner metadata instead of only `taskId`.
- Extend `WorkspaceArtifactSource` to include `automation` only when automation artifact providers are added.

Do this as compatibility-preserving extraction first. Behavior changes come later. Each extraction substep should have focused tests and a Kanban regression check before the next primitive moves.

Phase 5 implementation plan: [`2026-04-30-automations-phase-5-shared-execution-primitives.md`](2026-04-30-automations-phase-5-shared-execution-primitives.md).

### Phase 6: Add Manual Run Support

Add manual `Run now` support for automations.

Supported run modes:

- `chat`: resume or start a thread and send automation prompt.
- `local`: run in configured cwd without managed worktree.
- `worktree`: create a managed worktree and run there.

Persist run records, logs, event JSONL, prompt snapshots, and run profile snapshots.

Requirements:

- `Run now` uses the same execution-policy gates as Kanban run start, including trusted access, CSRF, sandbox, approval policy, and network-access checks.
- Manual runs are idempotent at the API boundary: double-clicks or retries must not create duplicate active runs for the same automation.
- Imported heartbeat definitions without `cwd` or run profile can only run in `chat` mode until configured.
- Worktree mode preserves dirty or failed worktrees for manual inspection and never deletes dirty state automatically.

Phase 6 implementation plan: [`2026-04-30-automations-phase-6-manual-run-support.md`](2026-04-30-automations-phase-6-manual-run-support.md).

### Phase 7: Add Scheduler And Recovery

Add due-run scheduling after manual runs are stable.

Requirements:

- Persist due/queued/running state before execution.
- Recover interrupted running jobs on server startup.
- Do not rely on the in-memory queue as the source of scheduled truth.
- Enforce one active run per automation and conservative global/repo limits.
- Make missed-run behavior explicit: default to one catch-up run, not unlimited replay.
- Ensure browser/mobile clients can create and inspect schedules, but server-side execution is driven by persisted server state, not by an open browser session.

### Phase 8: Add Triage And Artifact Indexing

Add result classification:

- `completed_with_findings`
- `completed_no_findings`
- `failed`

Add unread/read/archive states. Extend workspace artifacts with source `automation` and index automation runs, logs, worktrees, review packets, and proposals.

Artifact requirements:

- Update `src/types/workspaceArtifacts.ts` and artifact query validation before returning automation artifacts.
- Add an automation artifact provider to the existing `WorkspaceArtifactIndex` instead of special-casing automation artifacts in the route.
- Keep artifact raw/preview path checks strict: only indexed automation log/event paths are readable.

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

Projection writes must be idempotent by automation/run key so retries do not duplicate cards.

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

- Legacy thread automation API compatibility.
- Native automation store TOML round trip.
- Unknown TOML field preservation or sidecar-only write behavior.
- First-class automation route validation.
- Automations CSRF/trusted-access mutation coverage.
- Scheduler due calculation and startup recovery.
- Manual run lifecycle for chat/local/worktree.
- Duplicate manual-run prevention.
- Result classifier.
- Artifact indexing for automation source.
- Kanban projection idempotency.

Manual UI checks must cover light and dark theme. Playwright screenshots are only required when explicitly requested.

Per repo policy, each implementation slice that changes behavior or UI must update `tests.md` with manual verification steps. If a slice changes module loading or public server entrypoints, include the required CJS smoke test in the completion report.

## Open Questions

- Does Codex Desktop expose additional automation TOML fields that CodexUI should preserve exactly?
- Can a future Desktop/runtime release document or change the automation TOML schema, and how should CodexUI detect incompatible local records?
- Should global Automations be visible from both the app shell route and contextual thread sidebar, with editing centralized in the route?
- What is the first supported non-heartbeat template: daily project scan, PR babysitter, changelog summary, or deployment check?
- Should no-finding runs be hidden by default or visible in run history with compact grouping?
- How should the right sidebar link a selected chat thread to one or more automations?

## Recommended Next Step

Do Phase 0 quickly, then the right-sidebar IA cleanup. After that, implement Phases 2 through 4 as the first Automations slice, because that turns the existing heartbeat capability into a coherent product surface without taking on scheduler/execution risk immediately.
