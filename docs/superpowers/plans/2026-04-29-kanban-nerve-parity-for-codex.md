# Kanban Nerve Parity For Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring CodexUI Kanban to rough functional parity with Nerve's Kanban board while keeping the workflow designed around Codex threads, managed worktrees, review packets, and Tailscale-trusted phone use.

**Architecture:** Preserve the existing CodexUI Kanban boundary: Express API, JSON state file, Vue composable, and focused Vue components. Add Nerve-like data/config/query/proposal/reorder features as additive v2 contracts, then wire Codex-specific run completion through the existing bridge notification stream and `thread/read` rather than OpenClaw sessions.

**Tech Stack:** TypeScript, Express, Vue 3, Vitest, Vite, Codex app-server bridge, JSON file persistence under `${CODEX_HOME:-$HOME/.codex}/codexui-kanban`.

---

## Non-Negotiable Design Decisions

- Keep CodexUI statuses as the canonical default: `backlog`, `ready`, `running`, `review`, `rework`, `done`, `cancelled`.
- Treat Nerve status names as conceptual equivalents only: `todo` maps to `ready`, `in-progress` maps to `running`.
- Do not add OpenClaw agent/root-session concepts. CodexUI assignees are `operator`, `codex:auto`, or `codex:thread:<threadId>`.
- Preserve `CODEXUI_KANBAN_EXECUTION_ENABLED=1`, CSRF, trusted local/Tailscale access, managed worktrees, one-active-run limits, and audit logging.
- Do not merge, push, open PRs, or delete dirty worktrees automatically.
- Keep `/codex-api/kanban/state` for current UI compatibility while adding Nerve-like resource endpoints.

## File Map

### Data And Contracts

- Modify: `src/types/kanban.ts`
  - Add `KanbanPriority`, `KanbanActor`, `KanbanThinkingLevel`, `KanbanTaskFeedback`, `KanbanBoardColumn`, `KanbanBoardConfig`, `KanbanTaskListResult`, `KanbanProposalPayload`, and richer task fields.
- Modify: `src/server/kanban/migrations.ts`
  - Backfill existing v1 state with board config, task metadata defaults, and `columnOrder`.
- Create: `src/server/kanban/errors.ts`
  - Centralize typed errors: `KanbanNotFoundError`, `KanbanVersionConflictError`, `KanbanInvalidTransitionError`, `KanbanInvalidProposalError`.
- Modify: `src/server/kanban/schema.ts`
  - Parse create/update/list/reorder/config/proposal payloads.
- Modify: `src/server/kanban/taskService.ts`
  - Add list/query, CAS updates, config, reorder, feedback, result storage, and delete/archive semantics.
- Modify: `src/server/kanban/routes.ts`
  - Add `/tasks`, `/tasks/:id`, `/tasks/:id/reorder`, `/config`, richer proposals, and completion endpoints.

### Codex Execution And Proposals

- Modify: `src/server/kanban/codexBridgeAdapter.ts`
  - Allow `thread/read` for run completion output capture.
- Modify: `src/server/kanban/codexKanbanRunner.ts`
  - Subscribe to `turn/completed`, read final assistant output, parse markers, store result, generate review packet, and move task to review.
- Create: `src/server/kanban/markerParser.ts`
  - Parse `[kanban:create]` and `[kanban:update]` fenced JSON markers and return clean result text.
- Modify: `src/server/kanban/proposalService.ts`
  - Support create/update proposals, source actor/session metadata, versioning, resolution metadata, and config-driven `confirm` vs `auto` policy.
- Modify: `src/server/kanban/reviewPacketService.ts`
  - Keep review-packet behavior but support automatic generation after successful run completion.

### Frontend

- Modify: `src/api/kanbanGateway.ts`
  - Add list/config/reorder/proposal APIs and version-aware mutation payloads.
- Modify: `src/composables/useKanbanBoard.ts`
  - Track config, server-side query state, version conflicts, metadata mutations, reorder, and proposals.
- Modify: `src/components/kanban/KanbanBoardPage.vue`
  - Wire config, server filters, proposal inbox entry, metadata save, and reorder.
- Modify: `src/components/kanban/KanbanBoardViewport.vue`
  - Render configurable visible columns and emit reorder events.
- Modify: `src/components/kanban/KanbanColumn.vue`
  - Add WIP limit display and drop target state.
- Modify: `src/components/kanban/KanbanTaskCard.vue`
  - Show priority, assignee, due/estimate hints, result/review state.
- Modify: `src/components/kanban/KanbanTaskInspector.vue`
  - Add metadata editor sections and feedback/result display.
- Create: `src/components/kanban/KanbanProposalInbox.vue`
  - Full proposal inbox for create/update proposals.
- Create: `src/components/kanban/KanbanMetadataEditor.vue`
  - Priority, assignee, model, thinking, due date, estimate, actual duration.
- Create: `src/components/kanban/KanbanConfigPanel.vue`
  - Minimal board config editor for visible columns, WIP, defaults, proposal policy.

### Tests And Docs

- Add/modify tests under `src/server/kanban/__tests__/`.
- Add/modify tests under `src/composables/useKanbanBoard.test.ts`.
- Update: `tests.md`.
- Create: `docs/superpowers/reports/2026-04-29-kanban-parity-completion-report.md` at the end of implementation.

## Target API Contract

All responses keep the existing `{ data: ... }` success envelope. Errors keep the existing `{ error: string }` shape and add optional machine fields when useful.

```ts
type KanbanPriority = 'critical' | 'high' | 'normal' | 'low'
type KanbanActor = 'operator' | 'codex:auto' | `codex:thread:${string}`
type KanbanThinkingLevel = 'off' | 'low' | 'medium' | 'high'

type KanbanBoardColumn = {
  key: KanbanStatus
  title: string
  visible: boolean
  wipLimit: number | null
}

type KanbanBoardConfig = {
  columns: KanbanBoardColumn[]
  defaults: {
    status: KanbanStatus
    priority: KanbanPriority
  }
  reviewRequired: boolean
  allowDoneDragBypass: boolean
  quickViewLimit: number
  proposalPolicy: 'confirm' | 'auto'
  defaultModel: string
  defaultThinking: KanbanThinkingLevel
}

type KanbanTaskFeedback = {
  id: string
  atIso: string
  by: KanbanActor
  note: string
}
```

New or changed endpoints:

- `GET /codex-api/kanban/tasks?status=&priority=&assignee=&label=&q=&limit=&offset=`
- `GET /codex-api/kanban/tasks/:taskId`
- `POST /codex-api/kanban/tasks`
- `PATCH /codex-api/kanban/tasks/:taskId` with required `version`
- `DELETE /codex-api/kanban/tasks/:taskId` with required `version`, implemented as archive-preserving delete
- `POST /codex-api/kanban/tasks/:taskId/status` with required `version`
- `POST /codex-api/kanban/tasks/:taskId/reorder` with required `version`, `status`, `beforeTaskId`, `afterTaskId`
- `GET /codex-api/kanban/config`
- `PUT /codex-api/kanban/config`
- `POST /codex-api/kanban/runs/:runId/complete` for test/manual completion fallback
- `GET /codex-api/kanban/proposals?status=pending|approved|rejected`
- `POST /codex-api/kanban/proposals`
- `POST /codex-api/kanban/proposals/:proposalId/approve`
- `POST /codex-api/kanban/proposals/:proposalId/reject`

Existing proposal aliases `/accept` and `/reject` remain for compatibility; `/accept` calls the new approve path.

---

## Task 1: Expand Types And State Migration

**Files:**
- Modify: `src/types/kanban.ts`
- Modify: `src/server/kanban/migrations.ts`
- Test: `src/server/kanban/__tests__/storage.test.ts`
- Test: `src/server/kanban/__tests__/config.test.ts`

- [ ] **Step 1: Write failing migration tests**

Add tests that load a minimal v1 state containing two tasks in the same status and assert:

```ts
expect(task.priority).toBe('normal')
expect(task.createdBy).toBe('operator')
expect(task.assignee).toBe('codex:auto')
expect(task.feedback).toEqual([])
expect(task.columnOrder).toBeGreaterThanOrEqual(0)
expect(state.settings.kanbanConfig).toMatchObject({
  defaults: { status: 'backlog', priority: 'normal' },
  proposalPolicy: 'confirm',
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/storage.test.ts src/server/kanban/__tests__/config.test.ts
```

Expected: FAIL because migrated tasks do not yet include Nerve-parity metadata or board config.

- [ ] **Step 3: Add additive TypeScript contracts**

In `src/types/kanban.ts`, add the new exported types from the Target API Contract section. Extend `KanbanTask` with:

```ts
priority: KanbanPriority
createdBy: KanbanActor
sourceSessionKey: string
assignee: KanbanActor
columnOrder: number
result: string
resultAtIso: string
model: string
thinking: KanbanThinkingLevel
dueAtIso: string
estimateMinutes: number | null
actualMinutes: number | null
feedback: KanbanTaskFeedback[]
```

Extend `KanbanStateSnapshot` with:

```ts
config: KanbanBoardConfig
```

- [ ] **Step 4: Implement migration defaults**

In `src/server/kanban/migrations.ts`, add `createDefaultKanbanBoardConfig()` and `normalizeKanbanTask()`. Use current status order to compute `columnOrder` per column when missing. Store config at `state.settings.kanbanConfig`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/storage.test.ts src/server/kanban/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/kanban.ts src/server/kanban/migrations.ts src/server/kanban/__tests__/storage.test.ts src/server/kanban/__tests__/config.test.ts
git commit -m "feat: expand kanban state for parity metadata"
```

---

## Task 2: Add CAS, List Query, Config, And Reorder Services

**Files:**
- Create: `src/server/kanban/errors.ts`
- Modify: `src/server/kanban/schema.ts`
- Modify: `src/server/kanban/taskService.ts`
- Modify: `src/server/kanban/routes.ts`
- Test: `src/server/kanban/__tests__/taskService.test.ts`
- Test: `src/server/kanban/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests for:

```ts
await expect(service.updateTask(task.id, { version: task.version - 1, title: 'stale' }))
  .rejects.toMatchObject({ code: 'version_conflict' })
expect(await service.listTasks({ q: 'deploy', limit: 20, offset: 0 })).toMatchObject({
  total: 1,
  hasMore: false,
})
expect((await service.reorderTask(task.id, {
  version: task.version,
  status: 'ready',
  afterTaskId: other.id,
})).status).toBe('ready')
```

- [ ] **Step 2: Write failing route tests**

Add route tests for:

- `GET /tasks` returns `{ data: { items, total, limit, offset, hasMore } }`
- stale `PATCH /tasks/:id` returns `409` and includes `serverVersion` plus `latest`
- `GET /config` returns default config
- `PUT /config` changes a WIP limit
- `POST /tasks/:id/reorder` updates status and ordering

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/taskService.test.ts src/server/kanban/__tests__/routes.test.ts
```

Expected: FAIL because errors, list query, CAS, config, and reorder are not implemented.

- [ ] **Step 4: Implement typed errors**

Create `src/server/kanban/errors.ts`:

```ts
export class KanbanVersionConflictError extends Error {
  readonly code = 'version_conflict'
  constructor(readonly serverVersion: number, readonly latest: unknown) {
    super('Kanban task version conflict')
  }
}
```

Also add not-found, invalid-transition, and invalid-proposal classes with `code` fields.

- [ ] **Step 5: Implement parsers**

In `schema.ts`, add parsers for:

- `parseListTasksQuery(query: Request['query'])`
- `parseVersionedUpdateTaskInput(body)`
- `parseDeleteTaskInput(body)`
- `parseReorderTaskInput(body)`
- `parseBoardConfigInput(body)`

Validation rules:

- `version` is required and must be an integer >= 1 for update/status/archive/delete/reorder.
- `limit` defaults to `50`, maxes at `200`.
- `offset` defaults to `0`.
- `wipLimit` is `null` or integer >= 1.

- [ ] **Step 6: Implement service methods**

In `taskService.ts`, add:

```ts
listTasks(query): Promise<KanbanTaskListResult>
getTask(taskId): Promise<KanbanTask>
updateTask(taskId, inputWithVersion): Promise<KanbanTask>
deleteTask(taskId, inputWithVersion): Promise<KanbanTask>
reorderTask(taskId, input): Promise<KanbanTask>
getConfig(): Promise<KanbanBoardConfig>
updateConfig(input): Promise<KanbanBoardConfig>
```

Sort order: visible config column order, then `columnOrder`, then `updatedAtIso` descending.

- [ ] **Step 7: Wire routes**

Update `routes.ts` to expose the new endpoints. Keep `/state`, but make it include config from `service.listState()`.

- [ ] **Step 8: Run tests and verify GREEN**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/taskService.test.ts src/server/kanban/__tests__/routes.test.ts src/server/kanban/__tests__/policy.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/kanban/errors.ts src/server/kanban/schema.ts src/server/kanban/taskService.ts src/server/kanban/routes.ts src/server/kanban/__tests__/taskService.test.ts src/server/kanban/__tests__/routes.test.ts src/server/kanban/__tests__/policy.test.ts
git commit -m "feat: add kanban parity api services"
```

---

## Task 3: Update Gateway And Composable For Versioned Server State

**Files:**
- Modify: `src/api/kanbanGateway.ts`
- Modify: `src/composables/useKanbanBoard.ts`
- Test: `src/composables/useKanbanBoard.test.ts`

- [ ] **Step 1: Write failing composable tests**

Add tests that assert:

```ts
expect(gateway.updateKanbanTask).toHaveBeenCalledWith(task.id, {
  version: task.version,
  title: 'Renamed',
})
expect(board.config.value?.proposalPolicy).toBe('confirm')
expect(await board.reorderTask(task.id, { status: 'ready', afterTaskId: other.id })).toMatchObject({ status: 'ready' })
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
```

Expected: FAIL because the gateway/composable does not expose config, list, versioned mutations, or reorder.

- [ ] **Step 3: Add gateway methods**

In `kanbanGateway.ts`, add:

```ts
export async function listKanbanTasks(params: ListKanbanTasksParams): Promise<KanbanTaskListResult>
export async function loadKanbanConfig(): Promise<KanbanBoardConfig>
export async function updateKanbanConfig(input: UpdateKanbanBoardConfigInput): Promise<KanbanBoardConfig>
export async function reorderKanbanTask(taskId: string, input: ReorderKanbanTaskInput): Promise<KanbanTask>
export async function deleteKanbanTask(taskId: string, version: number): Promise<KanbanTask>
```

- [ ] **Step 4: Update composable state**

In `useKanbanBoard.ts`, add `config`, `listState`, `serverQuery`, `versionConflict`, and `proposals` refs. Make existing mutation helpers read `task.version` from local state and submit it with the mutation.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/kanbanGateway.ts src/composables/useKanbanBoard.ts src/composables/useKanbanBoard.test.ts
git commit -m "feat: wire kanban client to parity api"
```

---

## Task 4: Add Metadata UI And Server Filters

**Files:**
- Create: `src/components/kanban/KanbanMetadataEditor.vue`
- Modify: `src/components/kanban/KanbanToolbar.vue`
- Modify: `src/components/kanban/KanbanTaskCard.vue`
- Modify: `src/components/kanban/KanbanTaskInspector.vue`
- Modify: `src/components/kanban/KanbanTaskSheet.vue`
- Modify: `src/components/kanban/KanbanBoardPage.vue`
- Test: `src/composables/useKanbanBoard.test.ts`
- Update: `tests.md`

- [ ] **Step 1: Write failing composable/filter tests**

Assert priority/assignee filters are included in server list calls:

```ts
board.setPriorityFilter(['high'])
board.setAssigneeFilter('codex:auto')
await board.loadBoard()
expect(gateway.listKanbanTasks).toHaveBeenCalledWith(expect.objectContaining({
  priority: ['high'],
  assignee: 'codex:auto',
}))
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
```

Expected: FAIL because priority/assignee filter state does not exist.

- [ ] **Step 3: Create `KanbanMetadataEditor.vue`**

Fields:

- priority select: `critical`, `high`, `normal`, `low`
- assignee select/input: `operator`, `codex:auto`, `codex:thread:<threadId>`
- model input
- thinking select: `off`, `low`, `medium`, `high`
- due date input
- estimate and actual minute numeric inputs

Emit one event:

```ts
const emit = defineEmits<{
  save: [patch: KanbanMetadataPatch]
}>()
```

- [ ] **Step 4: Wire metadata into inspector and sheet**

Use `KanbanMetadataEditor` below the summary editor. On save, call `updateTask(taskId, { version: task.version, ...patch })`.

- [ ] **Step 5: Update toolbar filters**

Add compact controls for priority and assignee. Keep current search and label filters.

- [ ] **Step 6: Update cards**

Show priority and assignee in the task card metadata row. Keep text compact for mobile.

- [ ] **Step 7: Update `tests.md`**

Append a section named `Kanban Nerve-Parity Metadata And Filters` with light and dark theme manual steps.

- [ ] **Step 8: Run tests and build**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
pnpm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/kanban/KanbanMetadataEditor.vue src/components/kanban/KanbanToolbar.vue src/components/kanban/KanbanTaskCard.vue src/components/kanban/KanbanTaskInspector.vue src/components/kanban/KanbanTaskSheet.vue src/components/kanban/KanbanBoardPage.vue src/composables/useKanbanBoard.ts src/composables/useKanbanBoard.test.ts tests.md
git commit -m "feat: add kanban metadata and filters"
```

---

## Task 5: Add Configurable Columns, WIP Display, And Drag/Reorder

**Files:**
- Create: `src/components/kanban/KanbanConfigPanel.vue`
- Modify: `src/components/kanban/KanbanBoardViewport.vue`
- Modify: `src/components/kanban/KanbanColumn.vue`
- Modify: `src/components/kanban/KanbanTaskCard.vue`
- Modify: `src/components/kanban/KanbanBoardPage.vue`
- Test: `src/composables/useKanbanBoard.test.ts`
- Update: `tests.md`

- [ ] **Step 1: Write failing reorder tests**

Assert:

```ts
await board.reorderTask(task.id, { status: 'ready', afterTaskId: other.id })
expect(gateway.reorderKanbanTask).toHaveBeenCalledWith(task.id, {
  version: task.version,
  status: 'ready',
  afterTaskId: other.id,
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
```

Expected: FAIL before reorder wiring.

- [ ] **Step 3: Implement accessible drag/reorder**

Use native drag events. Do not add a new dependency. Requirements:

- card has `draggable="true"`
- drop target computes `status`, `beforeTaskId`, `afterTaskId`
- keyboard fallback remains status action buttons
- on version conflict, reload board and show mutation error

- [ ] **Step 4: Add WIP display**

In `KanbanColumn.vue`, display count as `count / wipLimit` when `wipLimit` is set. Apply a visible over-limit state without blocking drops.

- [ ] **Step 5: Add config panel**

`KanbanConfigPanel.vue` supports:

- visible toggle per column
- WIP limit numeric input
- default status
- default priority
- proposal policy `confirm` or `auto`

- [ ] **Step 6: Run tests and build**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
pnpm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/kanban/KanbanConfigPanel.vue src/components/kanban/KanbanBoardViewport.vue src/components/kanban/KanbanColumn.vue src/components/kanban/KanbanTaskCard.vue src/components/kanban/KanbanBoardPage.vue src/composables/useKanbanBoard.ts src/composables/useKanbanBoard.test.ts tests.md
git commit -m "feat: add kanban config and reorder ui"
```

---

## Task 6: Add Proposal V2 And Marker Parsing

**Files:**
- Create: `src/server/kanban/markerParser.ts`
- Modify: `src/server/kanban/proposalService.ts`
- Modify: `src/server/kanban/schema.ts`
- Modify: `src/server/kanban/routes.ts`
- Test: `src/server/kanban/__tests__/markerParser.test.ts`
- Test: `src/server/kanban/__tests__/proposalService.test.ts`

- [ ] **Step 1: Write failing marker parser tests**

Use this exact marker shape:

````markdown
Normal result text.

```kanban:create
{"title":"Follow-up task","description":"Check mobile layout","priority":"high","labels":[{"name":"ui","color":"blue"}]}
```

```kanban:update
{"taskId":"task_123","patch":{"blockedReason":"Needs credentials"}}
```
````

Assert parser returns two markers and clean result text without fenced marker blocks.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/markerParser.test.ts src/server/kanban/__tests__/proposalService.test.ts
```

Expected: FAIL because marker parser and proposal v2 do not exist.

- [ ] **Step 3: Implement marker parser**

`parseKanbanMarkers(text)` returns:

```ts
{
  cleanText: string
  markers: Array<
    | { type: 'create'; payload: CreateKanbanTaskInput }
    | { type: 'update'; payload: { taskId: string; patch: UpdateKanbanTaskInput } }
  >
}
```

Invalid JSON markers are ignored and left in `cleanText` so Codex output is never silently lost.

- [ ] **Step 4: Implement proposal v2**

Proposal fields:

```ts
type KanbanProposal = {
  id: string
  type: 'create' | 'update'
  payload: KanbanProposalPayload
  sourceRunId: string
  sourceThreadId: string
  proposedBy: KanbanActor
  status: 'pending' | 'approved' | 'rejected'
  version: number
  createdAtIso: string
  updatedAtIso: string
  resolvedAtIso: string
  resolvedBy: KanbanActor | ''
  reason: string
  resultTaskId: string
}
```

- [ ] **Step 5: Wire proposal routes**

Add:

- `GET /proposals?status=`
- `POST /proposals`
- `POST /proposals/:proposalId/approve`
- `POST /proposals/:proposalId/reject`

Keep aliases:

- `/proposals/:proposalId/accept` calls approve
- `/proposals/:proposalId/reject` remains reject

- [ ] **Step 6: Add config policy behavior**

If `proposalPolicy === 'auto'`, marker-created proposals are approved immediately. The default remains `confirm`.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/markerParser.test.ts src/server/kanban/__tests__/proposalService.test.ts src/server/kanban/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/kanban/markerParser.ts src/server/kanban/proposalService.ts src/server/kanban/schema.ts src/server/kanban/routes.ts src/server/kanban/__tests__/markerParser.test.ts src/server/kanban/__tests__/proposalService.test.ts src/server/kanban/__tests__/routes.test.ts
git commit -m "feat: add kanban marker proposals"
```

---

## Task 7: Capture Codex Run Completion

**Files:**
- Modify: `src/server/kanban/codexBridgeAdapter.ts`
- Modify: `src/server/kanban/codexKanbanRunner.ts`
- Modify: `src/server/kanban/routes.ts`
- Modify: `src/server/kanban/reviewPacketService.ts`
- Test: `src/server/kanban/__tests__/codexBridgeAdapter.test.ts`
- Test: `src/server/kanban/__tests__/codexKanbanRunner.test.ts`

- [ ] **Step 1: Write failing bridge adapter test**

Assert `thread/read` is allowed:

```ts
await expect(adapter.rpc('thread/read', { threadId: 'thread_1', includeTurns: true }))
  .resolves.toEqual({ ok: true })
```

- [ ] **Step 2: Write failing runner completion test**

Use a fake bridge that captures notification listeners. Start a task, emit:

```ts
listener({
  method: 'turn/completed',
  params: { threadId: 'thread_1', turnId: 'turn_1' },
})
```

Make fake `thread/read` return a latest `agentMessage` with one `kanban:create` marker. Assert:

```ts
expect(completedTask.status).toBe('review')
expect(completedTask.runState).toBe('succeeded')
expect(completedTask.result).toContain('Normal result text')
expect(completedTask.proposalIds).toHaveLength(1)
expect(completedTask.reviewPacketId).toMatch(/^review_packet_/)
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts
```

Expected: FAIL because `thread/read` and completion handling are missing.

- [ ] **Step 4: Allow `thread/read`**

Add `thread/read` to `KANBAN_CODEX_BRIDGE_ALLOWED_METHODS`.

- [ ] **Step 5: Implement completion subscription**

In `CodexKanbanRunner`, subscribe once in constructor. On `turn/completed`:

- match `threadId` and `turnId` to an active run
- call `thread/read` with `{ threadId, includeTurns: true }`
- extract latest `agentMessage.text`
- parse markers
- persist run `state: 'succeeded'`
- persist task `status: 'review'`, `runState: 'succeeded'`, `result`, `resultAtIso`
- create proposals from markers
- generate review packet
- emit run event `run.completed`

- [ ] **Step 6: Add manual completion fallback**

Route `POST /runs/:runId/complete` accepts `{ result: string, error?: string }`, requires trusted access and CSRF, and calls the same completion path. This gives a deterministic manual/test recovery path.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run src/server/kanban/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/kanban/__tests__/policy.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/kanban/codexBridgeAdapter.ts src/server/kanban/codexKanbanRunner.ts src/server/kanban/routes.ts src/server/kanban/reviewPacketService.ts src/server/kanban/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/kanban/__tests__/policy.test.ts
git commit -m "feat: complete kanban runs from codex output"
```

---

## Task 8: Build Proposal Inbox UI

**Files:**
- Create: `src/components/kanban/KanbanProposalInbox.vue`
- Modify: `src/components/kanban/KanbanBoardPage.vue`
- Modify: `src/api/kanbanGateway.ts`
- Modify: `src/composables/useKanbanBoard.ts`
- Test: `src/composables/useKanbanBoard.test.ts`
- Update: `tests.md`

- [ ] **Step 1: Write failing composable proposal tests**

Assert:

```ts
await board.loadProposals('pending')
expect(board.proposals.value).toHaveLength(1)
await board.approveProposal('proposal_1')
expect(gateway.approveKanbanProposal).toHaveBeenCalledWith('proposal_1')
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
```

Expected: FAIL because proposal inbox state/actions are missing.

- [ ] **Step 3: Add gateway/composable proposal actions**

Add `listKanbanProposals`, `createKanbanProposal`, `approveKanbanProposal`, and `rejectKanbanProposal` to gateway and composable.

- [ ] **Step 4: Build `KanbanProposalInbox.vue`**

UI requirements:

- pending/approved/rejected tabs
- type badge: create or update
- compact payload preview
- approve and reject buttons for pending proposals
- no nested cards
- mobile layout stacks controls under proposal content

- [ ] **Step 5: Wire into page**

Add proposal inbox below the toolbar or as an inspector side panel section. Loading proposals must not block board loading.

- [ ] **Step 6: Update manual tests**

Append `Kanban Proposal Inbox V2` to `tests.md`, including light and dark theme checks.

- [ ] **Step 7: Run tests and build**

Run:

```bash
pnpm vitest run src/composables/useKanbanBoard.test.ts
pnpm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/kanban/KanbanProposalInbox.vue src/components/kanban/KanbanBoardPage.vue src/api/kanbanGateway.ts src/composables/useKanbanBoard.ts src/composables/useKanbanBoard.test.ts tests.md
git commit -m "feat: add kanban proposal inbox"
```

---

## Task 9: Add CodexUI Kanban Agent Reference

**Files:**
- Create: `docs/kanban-codex-agent-reference.md`
- Update: `tests.md`

- [ ] **Step 1: Write the reference document**

Document:

- lifecycle: `backlog -> ready -> running -> review -> done`, with `rework` and `cancelled`
- Codex assignee model: `operator`, `codex:auto`, `codex:thread:<threadId>`
- safe execution model: Tailscale/local trusted access, CSRF, managed worktrees, no auto merge/push/PR
- marker syntax for create/update proposals
- completion behavior: result capture, marker parsing, proposal creation, review packet generation
- API examples for create, update, reorder, execute, complete, approve/reject proposal

- [ ] **Step 2: Update tests manual section**

Add a `Kanban Codex Agent Reference` section to `tests.md` with a docs review checklist.

- [ ] **Step 3: Verify docs**

Run:

```bash
rg -n "OpenClaw|nerve root|root session" docs/kanban-codex-agent-reference.md
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/kanban-codex-agent-reference.md tests.md
git commit -m "docs: add codex kanban agent reference"
```

---

## Task 10: Final Verification And Completion Report

**Files:**
- Create: `docs/superpowers/reports/2026-04-29-kanban-parity-completion-report.md`
- Update: `tests.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm run test:unit
pnpm run build
git diff --check
```

Expected:

- `test:unit`: all test files pass
- `build`: frontend and CLI builds pass
- `git diff --check`: no whitespace errors

- [ ] **Step 2: Manual phone/Tailscale smoke**

With server running:

```bash
CODEXUI_KANBAN_EXECUTION_ENABLED=1 pnpm run dev --host 0.0.0.0 --port 5173
```

From the host, verify:

```bash
curl -sS http://127.0.0.1:5173/codex-api/kanban/health
curl -sS -i -H 'x-forwarded-for: 100.100.100.100' http://127.0.0.1:5173/codex-api/kanban/csrf | sed -n '1,8p'
curl -sS -i -H 'x-forwarded-for: 203.0.113.10' http://127.0.0.1:5173/codex-api/kanban/csrf | sed -n '1,8p'
```

Expected:

- health returns `{"data":{"ok":true}}`
- Tailscale-range forwarded request returns `200`
- non-Tailscale forwarded request returns `403`

- [ ] **Step 3: Manual UI smoke**

Open `http://127.0.0.1:5173/#/kanban` and the Tailscale Serve URL on phone. Verify:

- create task with priority and assignee
- filter by priority and assignee
- drag task from `backlog` to `ready`
- start a run
- manually complete a run through fallback endpoint if automatic completion is not convenient to trigger
- approve/reject a marker proposal
- inspect review packet
- light theme is readable
- dark theme is readable

- [ ] **Step 4: Write completion report**

Create `docs/superpowers/reports/2026-04-29-kanban-parity-completion-report.md` with:

- commits included
- endpoints added
- known intentional differences from Nerve
- verification command outputs summarized
- manual Tailscale/phone result
- remaining gaps

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/reports/2026-04-29-kanban-parity-completion-report.md tests.md
git commit -m "docs: report kanban parity completion"
```

---

## Checkpoints

Checkpoint 1 after Task 3:

- Data/API compatibility exists.
- Existing UI still works.
- No drag/drop or proposals required yet.

Checkpoint 2 after Task 7:

- Codex run lifecycle parity exists.
- Marker proposals and review transition work.
- Phone/Tailscale execution remains guarded.

Checkpoint 3 after Task 10:

- Rough Nerve functional parity exists in CodexUI.
- UI exposes the parity features.
- Docs explain the Codex-specific workflow.

## Verification Commands

Run these before claiming the plan is complete:

```bash
pnpm run test:unit
pnpm run build
git diff --check
```

For focused Kanban checks:

```bash
pnpm vitest run src/server/kanban/__tests__ src/composables/useKanbanBoard.test.ts
```

## Plan Self-Review

- Spec coverage: Covers configurable board model, CAS, reorder, rich metadata, proposals, marker parsing, Codex completion capture, proposal inbox UI, and agent reference docs.
- Placeholder scan: No `TBD`, `TODO`, or unspecified follow-up tasks remain.
- Type consistency: Uses Codex-specific actor names consistently and keeps existing CodexUI statuses canonical.
- Scope control: Excludes automatic merge/push/PR and OpenClaw root-session behavior by design.
