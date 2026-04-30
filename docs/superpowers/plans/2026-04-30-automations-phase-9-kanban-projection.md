# Automations Phase 9 Kanban Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in automation-to-Kanban projection so automation definitions or selected run outcomes can create inert Kanban follow-up cards without auto-running or bypassing review policy.

**Architecture:** Store projection settings in the existing automation sidecar and project through a small automation-owned service that writes idempotently into the same `KanbanStorage`/`KanbanTaskService` instances used by the Kanban API. Definition-card projection runs when the automation is created or patched into that mode; run-card projection runs after automation run classification, records `kanbanTaskId` on the automation run, and never starts Kanban execution.

**Tech Stack:** TypeScript, Vitest, existing Automations service/runner/run store, existing Kanban storage/task service, existing execution policy.

---

## File Map

- `src/types/automations.ts`: replace `{ mode: 'off' }` with the Phase 9 projection union and add sidecar-compatible fields.
- `src/server/automations/schema.ts`: parse create/patch projection input safely.
- `src/server/automations/service.ts`: persist projection settings in `codexui.json`, expose `kanbanProjection: true`, and pass projection dependencies to runner.
- `src/server/automations/runner.ts`: invoke projection after a classified completion/failure and persist `kanbanTaskId`.
- `src/server/automations/kanbanProjection.ts`: projection engine and idempotency helpers.
- `src/server/kanban/index.ts`: accept an injected shared storage/service bundle for Kanban API routes.
- `src/server/kanban/routes.ts`: accept an injected shared storage/service bundle so Kanban API and projection do not race through separate mutation queues.
- `src/server/httpServer.ts`: wire Automations projection and Kanban API through the same Kanban storage/service instances.
- Tests:
  - `src/server/automations/__tests__/kanbanProjection.test.ts`
  - `src/server/automations/__tests__/routes.test.ts`
  - `src/server/automations/__tests__/runner.test.ts`
  - existing Kanban storage/task tests only if type fixtures require updates.
- `tests.md`: append manual verification for projection settings and inert Kanban cards.

## Slice 9A: Projection Settings Contract

**Files:**
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/schema.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing route/schema tests**

Add route tests that create/patch a definition with:

```ts
kanbanProjection: { mode: 'off' }
kanbanProjection: { mode: 'definition_card' }
kanbanProjection: { mode: 'run_card', createFor: 'findings_only' }
kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_existing' }
```

Assert malformed input rejects:

```ts
kanbanProjection: { mode: 'run_card', createFor: 'everything' }
kanbanProjection: { mode: 'attach_existing_task', taskId: '' }
kanbanProjection: { mode: 'auto_run' }
```

Also assert `attach_existing_task` with a missing or archived `taskId` is rejected before being persisted. Missing and archived task validation belongs to the projection service or injected task service path, not just string schema validation.

- [ ] **Step 2: Extend shared types**

Add:

```ts
export type AutomationKanbanProjection =
  | { mode: 'off' }
  | { mode: 'definition_card'; taskId?: string }
  | { mode: 'run_card'; createFor: 'every_run' | 'findings_only' | 'failures_only' }
  | { mode: 'attach_existing_task'; taskId: string }
```

Update `AutomationDefinition.kanbanProjection` to this union.

Update `AutomationsState.featureFlags.kanbanProjection` from literal `false` to `boolean` and set it according to whether the projection service is available.

- [ ] **Step 3: Persist projection in sidecar**

Add `kanbanProjection` to the sidecar read/write shape. Legacy sidecars must normalize to `{ mode: 'off' }`. Patches that omit `kanbanProjection` must preserve the existing sidecar value.

When `kanbanProjection.mode === 'definition_card'`, create or refresh the persistent definition card during `createDefinition()` and `patchDefinition()` before returning the definition. Repeated patches with the same setting must return the same `taskId` in the definition's projection state.

- [ ] **Step 4: Verify and commit Slice 9A**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/routes.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/types/automations.ts src/server/automations/schema.ts src/server/automations/service.ts src/server/automations/__tests__/routes.test.ts
git commit -m "feat(automations): persist kanban projection settings"
```

## Slice 9B: Idempotent Projection Engine

**Files:**
- Create: `src/server/automations/kanbanProjection.ts`
- Create: `src/server/automations/__tests__/kanbanProjection.test.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/kanban/index.ts`
- Modify: `src/server/kanban/routes.ts`
- Modify: `src/server/httpServer.ts`

- [ ] **Step 1: Add failing projection engine tests**

Use a temp `KanbanStorage` plus `KanbanTaskService`. Assert:

- `off` returns no task id.
- `definition_card` creates one task per automation at create/patch time and returns the same task id on repeated calls.
- `run_card` with `findings_only` creates a task for `completed_with_findings` and skips `completed_no_findings`.
- `run_card` with `failures_only` creates a task for `failed` and skips successful runs.
- `attach_existing_task` calls `taskService.getTask(taskId)`, rejects missing or archived tasks, and returns the existing task id without mutating it.
- Created tasks have `runState: 'idle'`, `status` equal to Kanban defaults, no `currentRunId`, and do not start execution.
- Concurrent Kanban API mutations and projection mutations share the same `KanbanStorage` instance in server wiring.

- [ ] **Step 2: Implement projection engine**

Create:

```ts
export type AutomationKanbanProjectionServiceOptions = {
  storage: KanbanStorage
  taskService: KanbanTaskService
}

export class AutomationKanbanProjectionService {
  async projectDefinition(input: { definition: AutomationDefinition }): Promise<{ taskId: string | null }>
  async projectRun(input: { definition: AutomationDefinition; run: AutomationRun }): Promise<{ taskId: string | null }>
}
```

Idempotency keys should be stable:

```text
automation:<automationId>:definition
automation:<automationId>:run:<runId>
```

Because `KanbanTask` has no metadata field for external keys, store keys as labels named exactly `automation:<...>` and find existing tasks by label before creating. Do not modify `KanbanTask` schema in this phase.

Created task title/description:

```text
Title: Automation: <definition.name>
Run title: Automation finding: <definition.name>
Description includes automation id, run id, run state, inbox title, inbox summary, and log path.
```

- [ ] **Step 3: Wire projection dependencies**

Extend `AutomationsServiceOptions` with:

```ts
kanbanProjection?: AutomationKanbanProjectionService
```

Pass it into `AutomationRunner`. In `httpServer.ts`, create the projection service from the existing `kanbanStorage`, `projectRoot`, and `kanbanConfig.policy` so it shares the same board state.

Update `createKanbanMiddleware()` / `createKanbanRouter()` so the production server can inject the same `KanbanStorage` and `KanbanTaskService` used by projection. The default test/helper path can still construct its own storage when no injected instances are provided, but `httpServer.ts` must create one storage/service pair and pass it to both Kanban and Automations.

- [ ] **Step 4: Verify and commit Slice 9B**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/kanbanProjection.test.ts src/server/automations/__tests__/routes.test.ts src/server/kanban/__tests__/routes.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/server/automations/kanbanProjection.ts src/server/automations/__tests__/kanbanProjection.test.ts src/server/automations/service.ts src/server/kanban/index.ts src/server/kanban/routes.ts src/server/httpServer.ts
git commit -m "feat(automations): add kanban projection engine"
```

## Slice 9C: Project Runs After Classification

**Files:**
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/__tests__/runner.test.ts`
- Modify: `tests.md`

- [ ] **Step 1: Add failing runner integration tests**

Add tests that:

- create or patch an automation to `definition_card`, then assert the definition immediately has a stable `taskId` and Kanban storage has one idle task.
- repeat the same patch and assert no duplicate definition task is created.
- complete a run with findings and `run_card/findings_only`, then assert the run has `kanbanTaskId` and Kanban storage has one idle task.
- complete the same notification twice and assert only one task exists.
- complete a no-findings run with `run_card/findings_only` and assert no task is created.
- complete a failed run with `run_card/failures_only` and assert one idle task is created.

- [ ] **Step 2: Invoke projection after classification**

After a run reaches a terminal state and triage fields are persisted, call projection when a projection service exists. Persist returned `kanbanTaskId` on the run. Projection errors should not change a completed run to failed; append an event/log entry:

```text
automation_projection.failed
```

with the error message.

- [ ] **Step 3: Update `tests.md`**

Append `Automations Phase 9 - Kanban projection` with setup, exact create/patch/run steps, expected inert Kanban card behavior, and cleanup notes.

- [ ] **Step 4: Verify and commit Slice 9C**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/kanbanProjection.test.ts src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/server/automations/runner.ts src/server/automations/service.ts src/server/automations/__tests__/runner.test.ts tests.md
git commit -m "feat(automations): project runs to kanban"
```

## Phase 9 Final Verification

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/kanbanProjection.test.ts src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts src/server/kanban/__tests__/storage.test.ts src/server/kanban/__tests__/taskService.test.ts
pnpm run build
git diff --check
```

Then dispatch spec and quality reviewers for the full Phase 9 diff before moving to Phase 10.
