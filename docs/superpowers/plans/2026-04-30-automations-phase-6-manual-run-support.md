# Automations Phase 6 Manual Run Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trusted, operator-triggered `Run now` support for automations with persisted run records, chat/local/worktree modes, and a compact route UI.

**Architecture:** Add a small automation run store under each native automation folder, then add an `AutomationRunner` that uses the shared restricted Codex bridge and shared worktree lock primitives. Manual runs remain API-driven and explicit; no scheduler, recovery loop, artifact indexing, Kanban projection, or background browser-dependent execution lands in this phase.

**Tech Stack:** TypeScript server modules, Express routes, shared Codex bridge adapter, shared managed worktree lock helpers, Vue route UI, Vitest, production build.

---

## Scope

In scope:

- Add `AutomationRun` types and first-class run state to API responses.
- Persist run records under `<automation-dir>/runs/<run-id>/run.json`, with adjacent `events.jsonl` and `run.log` paths.
- Add `POST /codex-api/automations/:automationId/run` for trusted CSRF-protected manual runs.
- Add `GET /codex-api/automations/:automationId/runs` for newest-first run history.
- Support `chat`, `local`, and `worktree` run modes:
  - `chat`: resume the target thread and send the automation prompt.
  - `local`: start a new thread in configured `cwd` and send the automation prompt.
  - `worktree`: create a managed worktree from configured `cwd` and send the automation prompt there.
- Prevent duplicate active manual runs for the same automation.
- Persist prompt, schedule, run profile, cwd/worktree/thread/turn snapshots.
- Complete manual runs from `turn/completed` notifications by reading the finished thread and marking the run `completed_no_findings` until Phase 8 result classification exists.
- Surface `Run now` and recent runs in the Automations route.
- Update `tests.md` with Phase 6 verification and light/dark manual UI checks.

Out of scope:

- Scheduler/due-run execution.
- Startup recovery of interrupted automation runs.
- Automation artifact source indexing.
- Result classification beyond `completed_no_findings` placeholder state.
- Kanban projection.
- Auto-cleanup of worktree runs.

## File Structure

- Modify: `src/types/automations.ts`
  - Add `AutomationRunMode = 'chat' | 'local' | 'worktree'`, `AutomationRunState`, `AutomationRun`, run history fields, and `featureFlags.manualRun: true`.
- Modify: `src/server/automations/schema.ts`
  - Accept `runMode: 'chat' | 'local' | 'worktree' | null`.
- Create: `src/server/automations/runStore.ts`
  - Persist, load, list, and update automation run records.
- Create: `src/server/automations/runner.ts`
  - Manual run lifecycle, per-automation serialization, duplicate-active guard, Codex bridge calls, completion notification handling, log/event writes, and worktree mode handoff.
- Create: `src/server/automations/policy.ts`
  - Automation execution policy defaults, access gates, and run-profile safety checks mirroring Kanban execution policy behavior.
- Create: `src/server/automations/__tests__/runner.test.ts`
  - Unit coverage for chat/local/worktree execution and duplicate-run prevention.
- Modify: `src/server/automations/service.ts`
  - Include recent runs in definitions and expose `runNow()` / `listRuns()`.
- Modify: `src/server/automations/routes.ts`
  - Add `POST /:automationId/run` and `GET /:automationId/runs`.
- Modify: `src/server/automations/index.ts`
  - Carry through the Codex bridge option.
- Modify: `src/server/httpServer.ts`
  - Pass the existing bridge runtime into automations middleware.
- Modify: `src/server/automations/__tests__/routes.test.ts`
  - API coverage for manual run route, CSRF, duplicate-active behavior, and bridge calls.
- Create: `src/server/workspaces/managedWorktreeService.ts`
  - Generic managed worktree creator for non-Kanban owners using the existing lock filename and owner metadata.
- Create: `src/server/workspaces/__tests__/managedWorktreeService.test.ts`
  - Worktree creation, owner metadata, dirty-preserving behavior, and duplicate-owner guard.
- Modify: `src/api/automationsGateway.ts`
  - Add `runAutomationNow()` and `listAutomationRuns()`.
- Modify: `src/api/automationsGateway.test.ts`
  - Gateway coverage for run endpoints and CSRF retry.
- Modify: `src/composables/useAutomations.ts`
  - Add `runSelectedNow()`, run history loading, and run mutation state.
- Modify: `src/composables/useAutomations.test.ts`
  - Composable coverage for run action and run history refresh.
- Modify: `src/components/automations/AutomationsPage.vue`
  - Add `Run now` button, run mode/cwd fields, and compact recent-run list.
- Modify: `src/style.css`
  - Add or strengthen global dark theme selectors if route-level dark theme surfaces regress.
- Modify: `tests.md`
  - Add Phase 6 manual run verification section.

## Phase 6 Policy And Completion Rules

- Reuse `KanbanExecutionPolicy` and `resolveKanbanConfig().policy` for this phase instead of inventing a separate policy shape. This keeps the existing environment toggle (`CODEXUI_KANBAN_EXECUTION_ENABLED=1`) as the conservative execution gate until a separate automations policy is introduced.
- A manual run may start only when execution mode is not `disabled`, access is trusted under the same local/Tailscale rules as Kanban execution, and the mutation has a valid Automations CSRF token.
- Resolve the run profile from the automation sidecar `runProfileId` against `BUILTIN_CODEX_RUN_PROFILES`; default to `workspace-coding` when empty.
- Apply automation sidecar `model` and `reasoningEffort` as run-profile snapshot overrides before resolving turn settings; this keeps the existing editor fields meaningful while retaining sandbox/approval/network defaults from the selected profile.
- Block `danger-full-access` unless `allowDangerFullAccess` is true, block approval policy `never` unless `allowApprovalNever` is true, and block `networkAccess: true` unless policy `networkAccess` is true.
- Pass `resolveCodexTurnStartRunSettings(profile, cwdOrWorktreePath)` into `turn/start`, so sandbox, approval, model, reasoning effort, network access, and writable roots are explicit in the bridge call.
- Maintain an in-process per-automation lock around `runNow()` so simultaneous `POST /run` requests cannot both observe no active run and start duplicate turns.
- Subscribe the runner to bridge `turn/completed` notifications. On a matching active automation run, call `thread/read`, persist `resultSummary`, set state to `completed_no_findings`, append `manual_run.completed`, and release the duplicate-run guard.
- If completion cannot be observed, the run remains active by design until Phase 7 recovery or an explicit later operator action; the completion-notification path is still required so normal successful turns do not block future runs forever.

## Slice 6A: Manual Run Store, API, Chat And Local Modes

**Files:**
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/schema.ts`
- Create: `src/server/automations/runStore.ts`
- Create: `src/server/automations/runner.ts`
- Create: `src/server/automations/policy.ts`
- Create: `src/server/automations/__tests__/runner.test.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/routes.ts`
- Modify: `src/server/automations/index.ts`
- Modify: `src/server/httpServer.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`
- Modify: `tests.md`

- [ ] **Step 1: Write failing server tests**
  - `POST /:automationId/run` requires trusted CSRF.
  - `chat` mode resumes `targetThreadId`, sends `turn/start`, persists a running record with thread/turn ids, and updates definition `lastRunAtIso`.
  - `local` mode requires absolute `cwd`, starts a new thread with that `cwd`, sends `turn/start`, and persists cwd/thread/turn snapshots.
  - Successful `turn/completed` notifications read the thread, mark the matching run `completed_no_findings`, persist a result summary, and allow a later manual run for the same automation.
  - Duplicate active runs for the same automation return a conflict without a second bridge call.
  - Simultaneous `Promise.all([POST /run, POST /run])` requests serialize per automation and start at most one bridge turn.
  - Execution disabled rejects the run before persistence/bridge calls.
  - `danger-full-access`, `approvalPolicy: never`, and `networkAccess: true` profiles are rejected unless their explicit policy toggles/settings are enabled.
  - `turn/start` receives resolved run settings from the selected/default run profile, including sidecar `model` and `reasoningEffort` overrides.
  - `GET /:automationId/runs` returns newest-first persisted runs.

- [ ] **Step 2: Implement run store and runner**
  - Store runs under `runs/<run-id>/run.json`.
  - Write `events.jsonl` entries for `manual_run.started`, `manual_run.turn_started`, and `manual_run.failed`.
  - Write `manual_run.completed` from `turn/completed` notification handling.
  - Write `run.log` lines with timestamped status summaries.
  - Treat `queued`, `starting`, and `running` as active for duplicate prevention.
  - Mark started runs as `running` after `turn/start` succeeds; mark validation/bridge failures as `failed`.

- [ ] **Step 3: Wire service and routes**
  - `CreateAutomationsRouterOptions` accepts `bridge?: CodexBridgeRuntime`.
  - `CreateAutomationsRouterOptions` accepts `policy?: KanbanExecutionPolicy`; `httpServer.ts` passes `resolveKanbanConfig().policy`.
  - `httpServer.ts` passes the shared bridge into automations middleware.
  - If no bridge is configured and a run is requested, return a clear 409/503 style error instead of writing a fake run.
  - `AutomationsService` owns one long-lived runner instance per service instance so completion notification subscriptions and per-automation locks are not recreated per request.

- [ ] **Step 4: Verify and commit Slice 6A**

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/legacyRoutes.test.ts
pnpm run build
git diff --check
git add src/types/automations.ts src/server/automations/schema.ts src/server/automations/runStore.ts src/server/automations/runner.ts src/server/automations/policy.ts src/server/automations/__tests__/runner.test.ts src/server/automations/service.ts src/server/automations/routes.ts src/server/automations/index.ts src/server/httpServer.ts src/server/automations/__tests__/routes.test.ts tests.md
git commit -m "feat(automations): add manual chat runs"
```

## Slice 6B: Worktree Mode And Route UI

**Files:**
- Create: `src/server/workspaces/managedWorktreeService.ts`
- Create: `src/server/workspaces/__tests__/managedWorktreeService.test.ts`
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/__tests__/runner.test.ts`
- Modify: `src/api/automationsGateway.ts`
- Modify: `src/api/automationsGateway.test.ts`
- Modify: `src/composables/useAutomations.ts`
- Modify: `src/composables/useAutomations.test.ts`
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `tests.md`

- [ ] **Step 1: Write failing worktree/UI tests**
  - Worktree mode creates a managed worktree with owner `{ source: 'automation', id: automationId }`.
  - Worktree mode starts Codex in the worktree path and stores worktree/branch snapshots.
  - Dirty worktree cleanup remains manual; runner does not remove worktrees.
  - Gateway and composable can start a run and refresh run history.
  - Worktree runs complete from the same `turn/completed` notification path and do not block later runs after completion.

- [ ] **Step 2: Implement generic managed worktree creation**
  - Use the existing `codexui-kanban-worktree.json` lock filename.
  - Branch prefix: `codexui/automation/<automation-id>-<run-id>-<name>`.
  - Lock `taskId` is the automation id for legacy compatibility; `owner` is the authoritative owner.
  - Block another active worktree for the same automation owner.

- [ ] **Step 3: Add UI controls**
  - Add a run mode selector with `Chat`, `Local cwd`, and `Managed worktree`.
  - Add `cwd` input; require it visually for local/worktree modes.
  - Add `Run now` button for saved automations.
  - Add a compact recent-run list with state, trigger, thread, turn, cwd/worktree, log path, and timestamps.
  - Do not add scheduler controls or Kanban projection controls.

- [ ] **Step 4: Verify and commit Slice 6B**

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/workspaces/__tests__/managedWorktreeService.test.ts src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
pnpm run build
git diff --check
git add src/server/workspaces/managedWorktreeService.ts src/server/workspaces/__tests__/managedWorktreeService.test.ts src/server/automations/runner.ts src/server/automations/__tests__/runner.test.ts src/api/automationsGateway.ts src/api/automationsGateway.test.ts src/composables/useAutomations.ts src/composables/useAutomations.test.ts src/components/automations/AutomationsPage.vue tests.md
git commit -m "feat(automations): add worktree manual runs"
```

## Final Phase 6 Review Gate

Run after Slice 6B:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run \
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

Manual UI verification:

- Start the dev server.
- Open `#/automations` in light theme, create or select a saved automation, run it, and confirm the recent-run list updates.
- Emit or simulate a matching completion notification in automated tests and confirm a second `Run now` is allowed after completion.
- Repeat route load and recent-run readability in dark theme.
- Confirm no scheduler, artifact-indexing, or Kanban-projection controls appear.
