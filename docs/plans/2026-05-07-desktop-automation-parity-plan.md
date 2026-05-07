# Desktop Automation Parity Plan

## Status
Proposed

## Date
2026-05-07

## Branch
`feature/automation-standalone-desktop-parity`

## Goal
Make CodexUI automations compatible with Codex Desktop automations so either app can create, edit, pause, resume, delete, and run automations without desynchronizing shared state.

The core rule is:

> Desktop automation TOML is the canonical shared contract. CodexUI must not write CodexUI-only fields into the shared desktop automation record unless the field is required for the automation to function in both apps.

CodexUI can keep private metadata only when it is clearly non-canonical, isolated from the desktop TOML contract, and safe for Desktop to ignore.

## Source Of Truth

Codex Desktop currently stores automation definitions under:

```text
$CODEX_HOME/automations/<automation_id>/automation.toml
```

Desktop-compatible canonical fields observed from the installed Linux desktop bundle and fixture are:

```toml
version = 1
id = "..."
kind = "cron" # or "heartbeat"
name = "..."
prompt = "..."
status = "ACTIVE" # or "PAUSED", "DELETED"
rrule = "RRULE:FREQ=..."
model = "..."
reasoning_effort = "..."
execution_environment = "local" # or "worktree"
cwds = ["/absolute/project/path"]
target_thread_id = "..."
local_environment_config_path = "..."
created_at = 1777654085276
updated_at = 1777654085276
```

CodexUI must preserve unknown TOML keys, comments, ordering where possible, and exact desktop values it does not understand.

## Non-Goals

- Do not make Kanban, artifacts, proposals, review packets, or right-panel features part of the standalone automation module.
- Do not require Codex Desktop to read CodexUI-specific sidecars to understand an automation.
- Do not persist CodexUI's current `runProfileId`, `kanbanProjection`, run archive/read state, or UI-only aliases into `automation.toml`.
- Do not invent a new automation storage format while Desktop already has one.

## Current Gaps And Alignment Plan

### 1. Canonical Storage Contract

Current CodexUI behavior:
- Reads and writes Desktop-like `automation.toml`.
- Also writes `codexui.json` sidecars for fields including `description`, `runMode`, `runProfileId`, `kanbanProjection`, and `notes`.
- Treats `cwd` as primary in several places while Desktop uses `cwds`.

Desktop behavior:
- `automation.toml` is the automation definition.
- `$CODEX_HOME/automations/<automation_id>/memory.md` is the per-automation memory file.
- Additional runtime state is driven by Desktop internals and thread state, not CodexUI sidecars.

Plan:
1. Define `DesktopAutomationRecord` as the canonical TypeScript type for the TOML schema.
2. Replace shared write paths so CodexUI writes only canonical desktop keys to `automation.toml`.
3. Retain private CodexUI metadata only under a clearly named non-canonical file, for example `codexui.local.json`, and only for UI affordances that are not required for Desktop compatibility.
4. Remove `runMode` as stored canonical data. Derive CodexUI run mode from `kind`, `target_thread_id`, `execution_environment`, and `cwds`.
5. Make `cwds[]` first-class; keep `cwd` only as a derived convenience value.
6. Add round-trip tests proving unknown TOML keys and comments survive CodexUI edits.

Acceptance:
- A Desktop-created TOML file can be loaded and saved by CodexUI without losing unknown keys.
- A CodexUI-created TOML file can be read by Desktop without CodexUI sidecars.
- Diff after no-op save changes nothing.

Section 1 implementation notes:
- Rename the sidecar file to `codexui.local.json` and treat existing `codexui.json` as a legacy read-only migration source.
- The sidecar must not supply canonical execution fields (`cwd`, `cwds`, `runMode`, `model`, `reasoningEffort`) when TOML already has Desktop fields.
- Introduce `cwds` to the create/patch contract now so service writes do not collapse Desktop multi-CWD automations.
- Keep any remaining Kanban/read-history behavior private and optional; do not expand it in this slice.
- Add exact no-op serialization tests for Desktop fixture TOML and local-environment fields.

### 2. Status Semantics

Current CodexUI behavior:
- Public UI type uses lowercase `active` and `paused`.
- Native store supports `ACTIVE` and `PAUSED`.
- `DELETED` is not a first-class persisted state.

Desktop behavior:
- Status values are uppercase: `ACTIVE`, `PAUSED`, `DELETED`.
- Delete flows can represent permanent deletion and missing/deleted automation states.

Plan:
1. Store Desktop status exactly as `ACTIVE`, `PAUSED`, or `DELETED`.
2. Make lowercase status labels view-only.
3. Teach parser and service layer to preserve `DELETED`.
4. Hide or mark deleted automations according to Desktop behavior, but do not rewrite them to `PAUSED` or remove them unless the user deletes.

Acceptance:
- CodexUI can list, display, and preserve all Desktop status values.
- Pause/resume write only `PAUSED`/`ACTIVE`.
- Delete behavior matches Desktop permanent delete semantics.

### 3. Heartbeat Semantics

Current CodexUI behavior:
- Treats `runMode = chat` as a scheduled prompt into a selected thread.
- Schedules heartbeat-like runs with generic RRULE due logic.
- Does not fully gate on target thread activity, renderer state, collaboration mode, or permissions.

Desktop behavior:
- Heartbeat is a short-interval thread watcher.
- It uses cooldown based on latest of `lastRunAt` and target thread update time.
- It blocks when the target thread is missing, busy, waiting on user input, waiting on approval, active without a terminal event, or renderer state says ineligible.
- It needs current collaboration mode and permissions from the renderer.

Plan:
1. Split scheduler execution into `cron` and `heartbeat` paths.
2. Implement Desktop-compatible heartbeat eligibility checks:
   - target thread exists
   - thread is not waiting on user input
   - thread is not waiting on approval
   - no active turn is in progress unless Desktop would treat it complete
   - renderer state has provided eligible collaboration mode
   - cooldown has elapsed
3. Add a browser/app-server bridge message equivalent to Desktop's `heartbeat-automation-thread-state-changed`.
4. For CodexUI web-only contexts where renderer state is unavailable, show heartbeat as not runnable rather than guessing.
5. Rename UI copy so heartbeat means "continuous short interval watcher", not generic "thread automation".

Acceptance:
- A heartbeat automation does not start when the selected thread is busy.
- A heartbeat automation advances next-run/cooldown like Desktop.
- Manual run reports clear errors if the thread is unavailable or renderer mode has not loaded.

### 4. Heartbeat Prompt Wrapper

Current CodexUI behavior:
- Sends the automation prompt directly as turn input.

Desktop behavior:
- Sends a structured heartbeat wrapper:

```xml
<heartbeat>
  <automation_id>{{AUTOMATION_ID}}</automation_id>
  <current_time_iso>{{NOW_ISO}}</current_time_iso>
  <instructions>
    {{AUTOMATION_PROMPT}}
  </instructions>
</heartbeat>
```

Plan:
1. Add a shared `buildHeartbeatPrompt()` helper.
2. Use this wrapper only for `kind = "heartbeat"`.
3. Preserve direct prompt behavior for `kind = "cron"`.
4. Add tests that assert exact wrapper structure.

Acceptance:
- Heartbeat turns include automation id and current ISO time.
- Cron turns do not get heartbeat XML.

### 5. Automation Memory

Current CodexUI behavior:
- Stores run logs and history in CodexUI-created JSON/log files.
- Does not require automation memory usage.

Desktop behavior:
- Automation prompt instructs agents to use:

```text
$CODEX_HOME/automations/<automation_id>/memory.md
```

Plan:
1. Create `memory.md` path handling in CodexUI automation service.
2. Include memory path in cron run prompt exactly like Desktop:
   - `Automation ID: <id>`
   - `Automation memory: $CODEX_HOME/automations/<id>/memory.md`
   - `Last run: <timestamp or never>`
3. Do not use a CodexUI-only memory location.
4. Surface memory file existence/path in Advanced metadata.

Acceptance:
- Every Desktop-compatible automation has a stable memory path.
- Cron runs include the same memory instruction Desktop provides.
- CodexUI does not create a competing memory file.

### 6. Scheduler State And Cross-App Race Avoidance

Current CodexUI behavior:
- Maintains `scheduler.json` and run records under the automation directory.
- Runs its own scheduler when Vite/server middleware is active.

Desktop behavior:
- Runs a 30-second scheduler loop.
- Runs at most three automations per tick.
- Updates next-run state using Desktop internals.

Risk:
- If Desktop and CodexUI are both open, both can schedule the same automation.

Plan:
1. Identify Desktop's persisted next-run fields and update behavior from current bundle/runtime.
2. Stop treating CodexUI `scheduler.json` as canonical.
3. Introduce a shared lease file if Desktop has no compatible lock:

```text
$CODEX_HOME/automations/<automation_id>/scheduler-lock.json
```

4. Lock fields should include owner, pid/process identity when available, acquiredAt, expiresAt, and intended due time.
5. CodexUI scheduler must acquire lease before starting a run and re-check canonical TOML/current due state after acquisition.
6. Prefer "Desktop owns scheduling" when Desktop is known active, unless user explicitly enables CodexUI scheduler.

Acceptance:
- Two CodexUI server instances do not double-run one automation.
- Desktop plus CodexUI do not double-run in normal active Desktop scenarios.
- If lock owner dies, stale lock expires safely.

### 7. RRULE And Schedule Semantics

Current CodexUI behavior:
- Supports `MINUTELY`, `HOURLY`, `DAILY`, and `WEEKLY`.
- Uses generic one-catch-up behavior.
- UI mostly exposes daily/weekly/custom.

Desktop behavior:
- Distinguishes interval schedules from wall-clock RRULE schedules.
- Heartbeat interval schedules use cooldown logic.
- Desktop UI includes minute intervals for heartbeat, hourly intervals, weekdays, weekly, custom RRULEs, and template presets.

Plan:
1. Port Desktop schedule classification:
   - interval minutes
   - interval hours
   - daily
   - weekdays
   - weekends
   - weekly by selected weekday
   - custom RRULE
2. Preserve `RRULE:` prefix exactly as Desktop writes it unless editing requires normalization.
3. For unsupported RRULEs, show "Custom schedule" and preserve raw value.
4. Add schedule tests from Desktop fixtures.

Acceptance:
- CodexUI displays Desktop RRULEs with the same labels where possible.
- CodexUI does not rewrite custom RRULEs on load.
- Heartbeat interval RRULEs are not treated as ordinary wall-clock cron schedules.

### 8. Multi-CWD Cron Execution

Current CodexUI behavior:
- Single `cwd` is primary for local/worktree automations.
- `cwds` exists in native store but UI and runner are single-project oriented.

Desktop behavior:
- Cron automations run against every path in `cwds`.
- If `cwds` is empty, scheduled run is skipped.

Plan:
1. Make `cwds` the canonical target field for cron/local/worktree automations.
2. Update UI project selector to support one or more project folders.
3. Update runner to iterate `cwds` serially like Desktop.
4. Record run results per target cwd without adding canonical TOML fields.
5. Treat `cwd === "~"` as projectless only after projectless support is implemented.

Acceptance:
- One cron automation with two `cwds` starts two target runs.
- Empty `cwds` shows an actionable validation error.
- Saving from CodexUI preserves Desktop's `cwds` array.

### 9. Projectless Automation

Current CodexUI behavior:
- Requires absolute project paths for local/worktree execution.

Desktop behavior:
- Uses `cwd = "~"` as projectless automation mode and can create generated directories under Documents/Codex.

Plan:
1. Add parser support for `cwds = ["~"]` or `cwd = "~"` without rejecting it as non-absolute.
2. Initially display projectless automations as read-only if runner support is not complete.
3. Implement Desktop-compatible generated output directory flow.
4. Preserve Desktop's projectless instructions in the run prompt.

Acceptance:
- CodexUI does not corrupt or reject Desktop projectless automations.
- Projectless automation creation is disabled until runner parity is complete.

### 10. Worktree Execution And Local Environments

Current CodexUI behavior:
- Uses `ManagedWorktreeService`.
- Does not fully round-trip `localEnvironmentConfigPath`.

Desktop behavior:
- Uses Desktop local-environment/worktree flow.
- Worktree creation considers repository root, current branch, and `localEnvironmentConfigPath`.

Plan:
1. Add canonical `local_environment_config_path` parsing/writing.
2. Prefer calling app-server/local-environment APIs where available rather than duplicating Desktop worktree behavior.
3. If local reimplementation is necessary, match Desktop inputs:
   - source workspace root
   - starting branch
   - local environment config path
   - host path normalization
4. Keep CodexUI worktree lock metadata private and non-canonical.

Acceptance:
- Desktop-created worktree automation with local environment config opens correctly in CodexUI.
- CodexUI-created worktree automation includes Desktop-compatible `execution_environment = "worktree"` and `cwds`.

### 11. Permissions, Sandbox, Model, And Reasoning

Current CodexUI behavior:
- Exposes Codex `runProfileId` and uses config-derived profiles.
- Stores `runProfileId` in sidecar.
- Applies model/reasoning through run profile resolution.

Desktop behavior:
- Canonical TOML stores `model` and `reasoning_effort`.
- Runtime derives approval/sandbox from saved config and config requirements.
- Heartbeat uses `model = null` and `effort = null`, relying on thread/current mode.

Plan:
1. Remove `runProfileId` from any shared automation persistence.
2. Keep profile selection as UI sugar that writes only canonical Desktop fields:
   - `model`
   - `reasoning_effort`
   - `execution_environment`
   - `local_environment_config_path`
3. For heartbeat, do not force model/reasoning into turn start unless Desktop does.
4. Use Desktop-compatible config resolution for approval/sandbox.
5. Preserve unsupported values visibly instead of rewriting them.

Acceptance:
- Changing profile in CodexUI results in Desktop-readable TOML only.
- Heartbeat runs do not override thread model/reasoning.
- Partial config profiles still inherit defaults in UI, but only canonical resolved values are persisted.

### 12. Run History And Inbox Compatibility

Current CodexUI behavior:
- Creates CodexUI run JSON, event log, read/archive state, and inbox summaries.

Desktop behavior:
- Uses running thread state, automation run notifications, and inbox directives from agent output.

Plan:
1. Treat CodexUI run history as a private cache, not canonical automation state.
2. Do not require run history files for Desktop compatibility.
3. Parse Desktop-created automation threads and inbox directives where possible.
4. Keep read/archive UI state local to CodexUI and do not write it into `automation.toml`.
5. Add a cleanup/migration path for old CodexUI run sidecars if they become misleading.

Acceptance:
- Deleting CodexUI run history does not break Desktop-compatible automation definitions.
- Desktop-created runs remain visible enough in CodexUI through thread/inbox state or a clear "Open thread" path.

### 13. Templates

Current CodexUI behavior:
- Provides three templates:
  - Thread heartbeat
  - Project cron
  - Worktree check

Desktop behavior:
- Provides grouped automation templates for:
  - status reports
  - release prep
  - incidents and triage
  - code quality
  - repo maintenance
- Templates include schedule presets and automation-specific prompts.

Plan:
1. Port Desktop's automation template catalog into a plain data module.
2. Store template outputs using canonical Desktop TOML fields only.
3. Keep simplified CodexUI templates only as aliases if they map cleanly to Desktop templates.
4. Make heartbeat template default to a short interval, not daily.
5. Add tests for template-to-TOML output.

Acceptance:
- Template-created automation is Desktop-readable without sidecars.
- Template schedules match Desktop defaults.

### 14. Thread Selection

Current CodexUI behavior:
- Allows broad chat search and manual thread ID entry.

Desktop behavior:
- Heartbeat selection is tied to eligible local/pinned threads.
- Threads already targeted by active heartbeat automations are marked unavailable.

Plan:
1. Keep project/title search, but align validation with Desktop:
   - local supported hosts only
   - target thread must exist unless user uses Advanced manual mode
   - active duplicate heartbeat target is blocked
2. Mark unavailable threads in the picker instead of allowing silent duplicate creation.
3. Move raw thread ID entry into Advanced.

Acceptance:
- User cannot accidentally create two active heartbeat automations for one thread.
- Manual ID entry remains possible but is visibly advanced and riskier.

### 15. Delete And Missing Automation Behavior

Current CodexUI behavior:
- Supports sidecar-only delete and native delete.

Desktop behavior:
- User delete means automation is permanently deleted/stopped.
- Missing automation UI explains that it may have been deleted or unavailable.

Plan:
1. Make normal delete remove the canonical Desktop automation.
2. Remove sidecar-only delete from primary UI.
3. Preserve sidecar cleanup only as developer/debug maintenance.
4. Add missing/deleted state messaging matching Desktop.

Acceptance:
- Deleting in CodexUI removes automation from Desktop.
- If Desktop deletes an automation, CodexUI shows missing/deleted state without recreating it.

## Implementation Phases

### Phase 1: Canonical Model And TOML Round-Trip

Files likely affected:
- `src/server/automations/nativeStore.ts`
- `src/server/automations/schema.ts`
- `src/types/automations.ts`
- `src/server/automations/__tests__/nativeStore.test.ts`
- `fixtures/desktop-automations/**`

Tasks:
1. Introduce `DesktopAutomationRecord`.
2. Parse and serialize canonical desktop fields.
3. Preserve unknown TOML keys/comments/order.
4. Remove canonical dependence on `codexui.json`.
5. Add Desktop fixture round-trip tests.

Verification:
- `pnpm vitest run src/server/automations/__tests__/nativeStore.test.ts`
- Add no-op serialization snapshot tests.

### Phase 2: Service/API Contract Cleanup

Files likely affected:
- `src/server/automations/service.ts`
- `src/server/automations/routes.ts`
- `src/api/automationsGateway.ts`
- `src/composables/useAutomations.ts`
- `src/types/automations.ts`

Tasks:
1. Make API expose Desktop-compatible fields plus derived display fields.
2. Remove `runProfileId`, `kanbanProjection`, and CodexUI-only state from create/patch payloads.
3. Keep private metadata endpoint only if needed for UI diagnostics.
4. Preserve `DELETED`.

Verification:
- API tests for create/edit/pause/resume/delete round-trip.
- Ensure Desktop TOML remains valid after API patch.

### Phase 3: Desktop-Compatible Scheduler

Files likely affected:
- `src/server/automations/scheduler.ts`
- `src/server/automations/schedulerStore.ts`
- `src/server/automations/scheduleCalculator.ts`
- `src/server/automations/runner.ts`

Tasks:
1. Split cron and heartbeat scheduling.
2. Implement Desktop interval vs wall-clock schedule semantics.
3. Add lease/race protection.
4. Make CodexUI scheduler optional when Desktop is active.

Verification:
- Scheduler tests for interval heartbeat, wall-clock cron, duplicate lock prevention, and stale lock recovery.

### Phase 4: Runner Parity

Files likely affected:
- `src/server/automations/runner.ts`
- `src/server/execution/runProfiles.ts`
- `src/server/codexAppServerBridge.ts`
- `src/server/workspaces/**`

Tasks:
1. Add Desktop-compatible cron prompt prefix and memory instructions.
2. Add heartbeat XML wrapper.
3. Use `cwds` iteration.
4. Align worktree/local environment behavior.
5. Align model/reasoning/permissions handling.

Verification:
- Runner tests for turn/start payloads.
- Manual dry-run against a fixture automation in a temporary `CODEX_HOME`.

### Phase 5: UI Alignment

Files likely affected:
- `src/components/automations/AutomationsPage.vue`
- `src/components/automations/AutomationThreadPicker.vue`
- `src/utils/automationDisplay.ts`
- `src/utils/automationDisplay.test.ts`

Tasks:
1. Change forms to edit canonical Desktop fields.
2. Move manual/raw fields to Advanced.
3. Replace templates with Desktop template catalog.
4. Make multi-cwd selection first-class.
5. Show heartbeat eligibility and unavailable-thread states.

Verification:
- Light/dark manual checks.
- Mobile checks for thread picker and multi-cwd selection.
- Display tests for Desktop RRULE summaries.

### Phase 6: Cross-App Compatibility Tests

Add a new test fixture suite:

```text
fixtures/desktop-automations/
  heartbeat-thread/
  cron-multi-cwd/
  worktree-local-env/
  projectless/
  custom-rrule/
  deleted/
```

Test cases:
1. Desktop TOML -> CodexUI load -> no-op save -> byte-equivalent except allowed normalized fields.
2. CodexUI create -> Desktop TOML parser fixture accepts it.
3. Desktop pause/resume edit -> CodexUI reflects status.
4. CodexUI pause/resume edit -> TOML remains Desktop-compatible.
5. Duplicate heartbeat target is blocked.
6. Unknown future Desktop fields are preserved.

## Migration Plan

1. Detect existing `codexui.json` sidecars.
2. For each sidecar:
   - move canonical-compatible fields into `automation.toml` only if Desktop supports them.
   - leave unsupported fields in `codexui.local.json` or ignore them.
   - do not write Kanban/artifact fields in standalone branch.
3. Emit diagnostics for sidecar-only settings that cannot be represented canonically.
4. Provide a one-time cleanup command or route for removing obsolete sidecars after verification.

## Compatibility Rules

- Desktop TOML wins over CodexUI sidecars.
- Unknown Desktop fields are preserved.
- Unsupported Desktop fields are shown read-only, not erased.
- CodexUI derived display fields must be recomputed from canonical data.
- CodexUI private metadata must not be required for Desktop to run an automation.
- Scheduler/run history private files must never alter canonical definition semantics.

## Open Questions

1. Does Desktop persist `nextRunAt`/`lastRunAt` only in internal state, or also in automation TOML/state files on all platforms?
2. What exact file, if any, does Desktop use as a scheduler lock?
3. Should CodexUI scheduler disable itself automatically whenever Desktop is running?
4. Should projectless automation creation be blocked until full generated-directory parity exists?
5. Should CodexUI expose Desktop's full template catalog immediately or phase it behind a feature flag?

## Done Criteria

The parity work is complete when:

1. Desktop-created automations load, edit, run, pause, resume, and delete correctly in CodexUI.
2. CodexUI-created automations appear and behave correctly in Desktop without needing CodexUI sidecars.
3. Both apps can alternately edit the same automation without losing fields or changing semantics.
4. Heartbeat behavior matches Desktop's cooldown and thread-eligibility model.
5. Cron/worktree automations use Desktop-compatible `cwds`, execution environment, model/reasoning, memory, and prompt structure.
6. Cross-app fixture tests cover all canonical cases.
7. Standalone branch still contains only automation stack plus thin app/server entry points needed to expose it.
