# Automations Phase 7 Scheduler And Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted scheduled automation execution and startup recovery without making the in-memory timer the source of truth.

**Architecture:** Keep existing native `automation.toml` records as the compatibility boundary and store CodexUI scheduler metadata in a separate per-automation `scheduler.json` file. The scheduler scans persisted definitions, records one catch-up decision at a time, persists a queued run before bridge execution, and uses the existing `AutomationRunner` lifecycle for chat/local/worktree execution. Server startup recovery marks interrupted active runs failed before the scheduler loop begins, so a previous process cannot wedge an automation forever.

**Tech Stack:** TypeScript, Express middleware lifecycle, Vitest, Node `fs/promises`, existing `AutomationRunner`, `AutomationsService`, `AutomationRunStore`, and Kanban execution policy limits.

---

## Scope Boundaries

In scope:
- Persist `nextDueAtIso` and scheduler bookkeeping under each automation directory.
- Compute due and next run times for the supported scheduler RRULE subset: `MINUTELY`, `HOURLY`, `DAILY`, `WEEKLY`, optional positive `INTERVAL`, optional `BYHOUR`, optional `BYMINUTE`, optional `BYDAY`.
- Preserve the existing route-accepted but scheduler-unsupported `MONTHLY` and `YEARLY` RRULE behavior: create/patch/read still succeed, `scheduler.json` records `unsupportedReason`, `nextRunAtIso` is `null`, and the scheduler skips the automation.
- Add `trigger: 'schedule'` run records.
- Persist `queued` scheduled runs before any bridge `thread/*` or `turn/start` call.
- Persist a durable scheduled due reservation before bridge RPCs by creating the queued run first, storing `dueAtIso` and `nextDueAtIso` on that run, then advancing `scheduler.json` with the queued run id before execution starts.
- Recover interrupted `queued`, `starting`, and `running` runs on scheduler startup.
- Enforce one active run per automation plus conservative global and per-repo limits before scheduled execution.
- Start the scheduler from the server process, not browser state.

Out of scope:
- Result classification beyond Phase 6 `completed_no_findings` behavior.
- Artifact indexing.
- Kanban projection.
- Desktop TOML schema changes.
- Browser automation or Playwright verification unless explicitly requested.

## Files

- Modify: `src/types/automations.ts`
  - Add schedule trigger to `AutomationRun.trigger`.
  - Change `AutomationDefinition.nextRunAtIso` from `null` to `string | null`.
  - Add `AutomationRun.dueAtIso` and `AutomationRun.nextDueAtIso` as nullable scheduler snapshots.
- Create: `src/server/automations/scheduleCalculator.ts`
  - Parse supported RRULE fields and compute one due/catch-up decision plus the next future due time.
- Create: `src/server/automations/schedulerStore.ts`
  - Read/write per-automation `scheduler.json`.
- Create: `src/server/automations/scheduler.ts`
  - Background loop, startup recovery, due scan, limit checks, and scheduled run dispatch.
- Modify: `src/server/automations/service.ts`
  - Surface `nextRunAtIso`, maintain scheduler state when definitions are created/patched/resumed/paused, expose recovery/scheduler candidate helpers.
- Modify: `src/server/automations/runner.ts`
  - Add scheduled-run trigger support and persist `queued` before starting bridge execution.
  - Expose recovery helper for active runs.
- Modify: `src/server/automations/index.ts`
  - Add lifecycle-aware middleware disposal for the scheduler loop.
- Modify: `src/server/httpServer.ts`
  - Enable scheduler for the production server and dispose it with the bridge.
- Tests:
  - Create: `src/server/automations/__tests__/scheduleCalculator.test.ts`
  - Create: `src/server/automations/__tests__/scheduler.test.ts`
  - Modify: `src/server/automations/__tests__/runner.test.ts`
  - Modify: `src/server/automations/__tests__/routes.test.ts`
  - Modify: existing fixtures in API/composable tests if type changes require `trigger`.
- Modify: `tests.md`
  - Add Phase 7 manual test section.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Link this detailed Phase 7 plan.

---

## Slice 7A: Persisted Scheduler State And Due Calculation

**Files:**
- Modify: `src/types/automations.ts`
- Create: `src/server/automations/scheduleCalculator.ts`
- Create: `src/server/automations/schedulerStore.ts`
- Create: `src/server/automations/__tests__/scheduleCalculator.test.ts`
- Create: `src/server/automations/__tests__/schedulerStore.test.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`

- [ ] **Step 1: Write due calculation tests**

Add tests proving:
- A daily schedule with `BYHOUR` and `BYMINUTE` reports due when the stored next due is before `now`.
- Missed-run handling returns exactly one catch-up decision and advances next due after `now`, not through every missed interval.
- Weekly `BYDAY` honors the allowed day list.
- `MONTHLY` and `YEARLY` return an unsupported scheduler result instead of throwing through the create/patch API path.
- Invalid RRULE fields that the route schema already rejects still throw a scheduler-specific error in direct calculator tests.

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/scheduleCalculator.test.ts
```

Expected before implementation: fail because the module does not exist.

- [ ] **Step 2: Implement `scheduleCalculator.ts`**

Create:

```ts
export type SchedulerDecision = {
  due: boolean
  dueAtIso: string | null
  nextDueAtIso: string | null
  missedRunPolicy: 'one_catch_up'
  unsupportedReason: string | null
}

export function evaluateRruleSchedule(input: {
  rrule: string
  nowIso: string
  nextDueAtIso: string | null
  anchorIso: string
}): SchedulerDecision
```

Implementation rules:
- If `nextDueAtIso` is null, compute the first future due after `anchorIso`.
- If the computed or persisted due time is `<= nowIso`, return `due: true`, `dueAtIso` as that due time, and `nextDueAtIso` as the first future due after `nowIso`.
- Never return multiple missed occurrences.
- For `MONTHLY` and `YEARLY`, return `due: false`, `dueAtIso: null`, `nextDueAtIso: null`, and `unsupportedReason` explaining that scheduler execution for that frequency is not implemented.
- Treat malformed values as `Error('Unsupported automation RRULE for scheduler: ...')`.

- [ ] **Step 3: Write scheduler store tests through service state**

Extend route/service tests to create an automation with a deterministic RRULE, then assert:
- The first-class definition exposes a non-null `nextRunAtIso` after create/read/list/state.
- `<automationDir>/scheduler.json` exists after create and contains `scheduleHash`, `nextDueAtIso`, `missedRunPolicy`, and `unsupportedReason: null`.
- Patching the schedule changes `scheduleHash` and refreshes `nextDueAtIso`.
- Resuming a paused automation refreshes scheduler state.
- Creating or patching an otherwise valid `FREQ=MONTHLY` or `FREQ=YEARLY` automation succeeds, writes `scheduler.json` with `unsupportedReason`, and returns `nextRunAtIso: null`.

Expected before service integration: fail because `nextRunAtIso` remains null.

- [ ] **Step 4: Implement `schedulerStore.ts` and service integration**

Create a per-automation store at `<automationDir>/scheduler.json`:

```ts
export type AutomationSchedulerState = {
  automationId: string
  sourceDirName: string
  scheduleHash: string
  nextDueAtIso: string | null
  lastDueAtIso: string | null
  lastScheduledRunId: string | null
  lastEvaluatedAtIso: string | null
  missedRunPolicy: 'one_catch_up'
  unsupportedReason: string | null
  updatedAtIso: string
}
```

Service behavior:
- `createDefinition()` writes initial scheduler state after the native record and sidecar are written.
- `patchDefinition()` refreshes scheduler state when `schedule`, `status`, or execution target fields change.
- `resumeDefinition()` refreshes scheduler state.
- `pauseDefinition()` keeps existing state but `mapDefinition()` may still show `nextRunAtIso`; the scheduler must skip paused records later.
- `mapDefinition()` reads `scheduler.json` and returns `nextRunAtIso: state.nextDueAtIso ?? null`.
- If `scheduler.json` is absent for an imported native automation, `mapDefinition()` computes a transient value for display only, but the scheduler tick must lazily initialize and persist `scheduler.json` before considering the automation for execution.
- If the schedule is route-valid but scheduler-unsupported, write `unsupportedReason`, clear `nextDueAtIso`, and ensure stale previous due state cannot survive a patch from supported to unsupported.

- [ ] **Step 5: Run Slice 7A tests**

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run \
  src/server/automations/__tests__/scheduleCalculator.test.ts \
  src/server/automations/__tests__/schedulerStore.test.ts \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/__tests__/legacyRoutes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit Slice 7A**

```bash
git add src/types/automations.ts \
  src/server/automations/scheduleCalculator.ts \
  src/server/automations/schedulerStore.ts \
  src/server/automations/__tests__/scheduleCalculator.test.ts \
  src/server/automations/__tests__/schedulerStore.test.ts \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/service.ts \
  docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md
git commit -m "feat(automations): persist scheduler state"
```

---

## Slice 7B: Scheduled Runs And Startup Recovery

**Files:**
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/runStore.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/schedulerStore.ts`
- Modify: `src/server/automations/__tests__/runner.test.ts`

- [ ] **Step 1: Write scheduled runner tests**

Add tests proving:
- `service.runScheduled('daily-check', { dueAtIso })` creates a `trigger: 'schedule'` run.
- The scheduled run is written to disk as `state: 'queued'` before bridge calls start.
- The scheduled run stores `dueAtIso` and `nextDueAtIso` snapshots before bridge calls start.
- The queued run is created before `scheduler.json` advances, and `scheduler.json` is advanced with `lastScheduledRunId` before bridge calls start, so every crash window has either no reservation or a recoverable queued run.
- If queue creation fails before a run record exists, `scheduler.json` is not advanced.
- A defensive recovery/scheduler test covers corrupted `scheduler.json` advanced with no matching run record: the scheduler treats the missing run as an incomplete reservation and requeues the due instead of silently dropping it.
- A queued scheduled run transitions to `running` after the bridge starts a turn.
- A second scheduled or manual start is rejected while the first scheduled run is active.
- Recovery with stale `scheduler.json.nextDueAtIso` plus an existing queued scheduled run reconciles from the run's stored `nextDueAtIso` and does not schedule the same due time again.

Expected before implementation: fail because `runScheduled()` does not exist.

- [ ] **Step 2: Implement scheduled trigger support**

In `AutomationRun`:

```ts
trigger: 'manual' | 'schedule'
```

Add nullable scheduler snapshots to `AutomationRun`:

```ts
dueAtIso: string | null
nextDueAtIso: string | null
```

In `AutomationRunner`:
- Add public `runScheduled(input)` that calls the existing locked start path with `{ trigger: 'schedule', initialState: 'queued', dueAtIso, nextDueAtIso, runId? }`.
- Keep `runNow()` using `{ trigger: 'manual', initialState: 'starting' }`.
- For scheduled runs, write the run record with `state: 'queued'`, `dueAtIso`, and `nextDueAtIso`, append `scheduled_run.queued`, then call back into service/scheduler-store code to advance `scheduler.json` with `lastDueAtIso`, `nextDueAtIso`, and `lastScheduledRunId`.
- Only after both the queued run and scheduler state are durable should the runner update to `starting` and invoke bridge RPCs.
- Continue using the same completion notification path as manual runs.

- [ ] **Step 3: Write startup recovery tests**

Add tests proving:
- A persisted `queued`, `starting`, or `running` run from a previous service instance is marked `failed`.
- Recovery writes `completedAtIso`, `errorMessage`, an event, and a log entry.
- Recovery is idempotent and does not mutate completed or failed runs.
- If a recovered scheduled run has `nextDueAtIso` later than the current `scheduler.json.nextDueAtIso`, recovery advances `scheduler.json` to the run snapshot before marking it failed.

Expected before implementation: fail because only the manual `failOrphanedActiveRuns()` path exists and only runs when starting another run.

- [ ] **Step 4: Implement recovery helper**

Expose:

```ts
async recoverInterruptedRuns(): Promise<{ recovered: number }>
```

Behavior:
- Scan all native automation entries.
- For each run in `queued`, `starting`, or `running`, mark it `failed`.
- Error message: `Automation run was interrupted by a previous server session`.
- Append event type `scheduler.recovered_failed`.
- Append a matching log line.
- Before marking a scheduled active run failed, reconcile scheduler state from the run's `dueAtIso` and `nextDueAtIso` so the same due time is not replayed after restart.
- Do not delete worktrees.

- [ ] **Step 5: Run Slice 7B tests**

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run \
  src/server/automations/__tests__/runner.test.ts \
  src/server/automations/__tests__/routes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit Slice 7B**

```bash
git add src/types/automations.ts \
  src/server/automations/runner.ts \
  src/server/automations/runStore.ts \
  src/server/automations/service.ts \
  src/server/automations/schedulerStore.ts \
  src/server/automations/__tests__/runner.test.ts \
  src/server/automations/__tests__/routes.test.ts
git commit -m "feat(automations): add scheduled run recovery"
```

---

## Slice 7C: Scheduler Loop, Limits, Lifecycle, And Docs

**Files:**
- Create: `src/server/automations/scheduler.ts`
- Create: `src/server/automations/__tests__/scheduler.test.ts`
- Modify: `src/server/automations/index.ts`
- Modify: `src/server/httpServer.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`
- Modify: `tests.md`

- [ ] **Step 1: Write scheduler loop tests**

Add tests proving:
- `AutomationScheduler.tick()` scans persisted active definitions and starts one due run.
- Paused definitions are skipped.
- Imported native automations with no `scheduler.json` are lazily initialized on tick before scheduling decisions.
- When multiple schedules are missed, only one catch-up run is started per automation tick and `scheduler.json.nextDueAtIso` advances beyond `now`.
- `MONTHLY` and `YEARLY` scheduler states are skipped with no run start.
- `maxGlobalActiveRuns` blocks additional scheduled starts when active persisted runs already meet the policy limit.
- Per-repo limit blocks two due local/worktree automations with the same `cwd`.
- Scheduler startup calls recovery before first due scan.
- Delayed startup recovery prevents any due run from starting until recovery has finished.

Expected before implementation: fail because `scheduler.ts` does not exist.

- [ ] **Step 2: Implement `AutomationScheduler`**

Create:

```ts
export class AutomationScheduler {
  constructor(options: {
    service: AutomationsService
    intervalMs?: number
    now?: () => Date
  })
  start(): void
  stop(): void
  tick(): Promise<void>
}
```

Rules:
- `start()` creates and stores a startup recovery promise immediately, then starts an interval. It does not need to return a promise, but every `tick()` must await the stored startup recovery promise before scanning due work.
- `tick()` is serialized; overlapping intervals must not run concurrently.
- The scheduler reads persisted `scheduler.json` and persisted run records every tick.
- The scheduler never stores pending truth only in memory.
- Due scheduled starts call `service.runScheduled(definition.id, { dueAtIso, nextDueAtIso })`; that service call owns the durable reservation sequence: create queued run, advance `scheduler.json` with the queued run id, then start bridge execution.
- If a crash happens after queued run creation but before `scheduler.json` advances, recovery must use active scheduled run snapshots to reconcile scheduler state and avoid replay.
- If a corrupted or legacy state has `scheduler.json` advanced with a missing `lastScheduledRunId`, the scheduler must not treat the due as completed; it should clear the incomplete reservation and requeue one catch-up run.
- If a run is blocked by active-run limits, leave `nextDueAtIso` unchanged so the next tick retries.

- [ ] **Step 3: Wire server lifecycle**

In `src/server/automations/index.ts`:
- Add `enableScheduler?: boolean` and `schedulerIntervalMs?: number` options.
- Create one `AutomationsService`.
- If `enableScheduler === true` and a bridge exists, start `AutomationScheduler`.
- Return a request handler with a `dispose?: () => void` property that stops the scheduler.

In `src/server/httpServer.ts`:
- Pass `enableScheduler: true` when creating automations middleware.
- Call `automations.dispose?.()` inside `ServerInstance.dispose()`.

In tests:
- Pass `enableScheduler: false` for route tests that only need API behavior.
- Add a route/server test that asserts disposal calls the scheduler stop path without leaking an interval.

- [ ] **Step 4: Update state flags and tests documentation**

Update `AutomationsService.listState()` so `featureFlags.scheduler` is true when scheduler support is enabled by service options.

Append `tests.md` section:
- Feature/change name: Automations Phase 7 scheduler and recovery.
- Prerequisites/setup: active heartbeat automation with schedule and bridge-enabled server.
- Steps: inspect `scheduler.json`, trigger a due tick or wait one interval, inspect run history, restart server with an active run and confirm recovery.
- Expected results: one scheduled run, no unlimited replay, active run recovered as failed on startup, light/dark UI still shows next run/run history.
- Unsupported schedules: `FREQ=MONTHLY`/`FREQ=YEARLY` remain readable/editable but show no next run and do not execute until support is added.
- Rollback: pause automation or remove `scheduler.json` and run records under the test automation directory.

- [ ] **Step 5: Run Slice 7C tests**

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run \
  src/server/automations/__tests__/scheduler.test.ts \
  src/server/automations/__tests__/runner.test.ts \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/__tests__/legacyRoutes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Run Phase 7 final gate**

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run \
  src/server/automations/__tests__/scheduleCalculator.test.ts \
  src/server/automations/__tests__/scheduler.test.ts \
  src/server/automations/__tests__/runner.test.ts \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/__tests__/legacyRoutes.test.ts \
  src/server/workspaces/__tests__/managedWorktreeService.test.ts \
  src/server/workspaces/__tests__/worktreeService.test.ts \
  src/api/automationsGateway.test.ts \
  src/composables/useAutomations.test.ts
pnpm run build
git diff --check
```

Expected: all tests pass, build succeeds, diff check is clean.

- [ ] **Step 7: Commit Slice 7C**

```bash
git add src/server/automations/scheduler.ts \
  src/server/automations/__tests__/scheduler.test.ts \
  src/server/automations/index.ts \
  src/server/httpServer.ts \
  src/server/automations/service.ts \
  src/server/automations/__tests__/routes.test.ts \
  tests.md
git commit -m "feat(automations): run persisted scheduler"
```

---

## Phase 7 Review Checklist

- [ ] Scheduler truth is persisted in `scheduler.json`; pending due work is not only held in memory.
- [ ] Scheduled execution writes a run record before bridge RPCs begin.
- [ ] Scheduled execution reserves the due in `scheduler.json` and stores due snapshots on the run before bridge RPCs begin.
- [ ] Startup recovery handles `queued`, `starting`, and `running` runs.
- [ ] Startup recovery awaits before due scanning and reconciles stale scheduler state from active scheduled runs.
- [ ] One active run per automation remains enforced.
- [ ] Global and per-repo limits are enforced before scheduled starts.
- [ ] Missed runs produce one catch-up run and advance the next due time after `now`.
- [ ] `MONTHLY` and `YEARLY` route-valid schedules are unsupported for scheduler execution without API regression or stale due state.
- [ ] Paused automations do not run.
- [ ] Worktree cleanup behavior is unchanged; failed/dirty worktrees are preserved.
- [ ] No artifact indexing or Kanban projection code lands in Phase 7.
- [ ] `tests.md` includes manual light/dark checks for the changed Automations route data.

## Self-Review Notes

- Spec coverage: Phase 7 high-level requirements map to slices 7A through 7C. Due state and next-run inspection are in 7A, queued/scheduled/recovery behavior is in 7B, and server-driven execution plus limits are in 7C.
- Placeholder scan: no `TBD` or open-ended implementation placeholders remain; each task names files, behavior, and verification commands.
- Type consistency: the plan consistently uses `nextDueAtIso` for scheduler storage, `nextRunAtIso` for public definitions, and `trigger: 'schedule'` for scheduled run records.
