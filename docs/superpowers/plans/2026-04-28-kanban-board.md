# Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class, local-first Kanban board to CodexUI, starting with board CRUD and server-side persistence, then adding opt-in, loopback-only execution through managed worktrees.

**Architecture:** The Kanban feature lives inside the existing Vue SPA and Express server. Board state is served by `/codex-api/kanban/*` HTTP endpoints mounted before the generic Codex bridge, while Codex execution later uses a narrow internal bridge adapter rather than adding Kanban methods to the public RPC namespace.

**Tech Stack:** Vue 3, Vue Router hash routes, TypeScript, Vite, Express 5 middleware, Vitest, existing Tailwind 4 styling, existing Codex app-server bridge.

---

## Source And Current Repo Truth

Source spec: `/tmp/codex-web-uploads/f-uxq4ju/pasted-text-2026-04-28-16-25-29.txt`.

Updated base: `main` was fast-forwarded from `upstream/main` to `f0676bb`.

Current repo facts that this plan depends on:

- `src/router/index.ts` uses `createWebHashHistory()` with routes for `/`, `/thread/:threadId`, `/skills`, and `/new-thread`.
- `src/App.vue` owns the shell route branches. It already lazy-loads `DirectoryHub`, `ThreadConversation`, `ThreadTerminalPanel`, and `ReviewPane`.
- `src/server/httpServer.ts` currently mounts `createCodexBridgeMiddleware()` before local-file/static routes. Kanban middleware must mount before that bridge.
- `vite.config.ts` creates the same bridge middleware for dev and handles `/codex-api/ws` upgrades. Kanban dev middleware must be registered before the bridge catch-all handler.
- `src/server/codexAppServerBridge.ts` already has an internal `appServer.rpc()` and `subscribeNotifications()` inside the middleware implementation. The missing piece is a typed, narrow exported runtime surface for server modules.
- `src/server/reviewGit.ts` has reusable Git diff/review logic, but most helpers are private. Review packet work should export focused helpers instead of duplicating Git parsing.
- There is no `tests/` directory and no `whatToTest.md`. Existing manual verification documentation lives in `tests.md`.

## Implementation Boundaries

Ship in two executable releases:

- **v0.1 Board CRUD:** route, nav, server persistence, create/edit/archive/status, labels, acceptance criteria, search/filter, light/dark/manual verification. No task execution.
- **v0.2 Safe Execution:** disabled by default, loopback-only, managed worktrees, one active run, safe Codex `turn/start`, logs, interrupt, review packet, rework, proposals, audit.

Do not add in v0:

- Drag/drop.
- Pinia, Vuex, SQLite, component frameworks, external task managers.
- Autonomous merge, auto-PR, auto-push, or `thread/shellCommand`.
- Execution using inherited `danger-full-access` or `approvalPolicy=never`.

Stop after Task 6 for the first implementation checkpoint. Tasks 7-12 cross execution, audit, worktree, app-server, and recovery trust boundaries; before starting Task 7, write a focused v0.2 execution addendum that locks down:

- exact `CodexBridgeRuntime` implementation shape in `src/server/codexAppServerBridge.ts`
- CSRF token issuance, storage, and request header contract
- actor/session model for audit events
- notification correlation rules for `threadId`, `turnId`, `taskId`, and `runId`
- persisted run state machine and startup recovery transitions
- exact smoke command for built ESM/server module loading

## File Map

Create for v0.1:

- `src/types/kanban.ts`: shared frontend/server Kanban DTOs, status constants, request/response types.
- `src/server/kanban/index.ts`: public middleware factory export.
- `src/server/kanban/config.ts`: safe config defaults and env parsing.
- `src/server/kanban/schema.ts`: runtime input normalization and validation helpers.
- `src/server/kanban/ids.ts`: task/board/criterion/run ID helpers.
- `src/server/kanban/paths.ts`: data-dir and state-file path helpers.
- `src/server/kanban/storage.ts`: atomic JSON state load/mutate/write.
- `src/server/kanban/migrations.ts`: state-file migration entrypoint.
- `src/server/kanban/eventBus.ts`: in-process Kanban event emitter and SSE formatter.
- `src/server/kanban/routes.ts`: HTTP endpoint router.
- `src/server/kanban/taskService.ts`: board/task mutations over storage.
- `src/api/kanbanGateway.ts`: frontend fetch wrapper for Kanban endpoints.
- `src/composables/useKanbanBoard.ts`: page state, filters, selected task, task actions.
- `src/components/kanban/KanbanBoardPage.vue`: route page.
- `src/components/kanban/KanbanToolbar.vue`: create/search/filter controls.
- `src/components/kanban/KanbanBoardViewport.vue`: desktop/mobile board switch.
- `src/components/kanban/KanbanMobileStatusTabs.vue`: compact mobile status selector.
- `src/components/kanban/KanbanColumn.vue`: desktop status column.
- `src/components/kanban/KanbanTaskCard.vue`: task summary card.
- `src/components/kanban/KanbanTaskInspector.vue`: desktop task details.
- `src/components/kanban/KanbanTaskSheet.vue`: mobile full-height task details.
- `src/components/kanban/TaskSummaryEditor.vue`: title, description, labels.
- `src/components/kanban/AcceptanceCriteriaEditor.vue`: criterion editor.
- `src/components/kanban/TaskStatusActions.vue`: explicit transitions.
- `src/components/kanban/KanbanEmptyState.vue`: empty/error state component.
- `src/components/icons/IconTablerLayoutKanban.vue`: local Tabler-style icon.
- `src/server/kanban/__tests__/storage.test.ts`: storage and corrupt-file behavior.
- `src/server/kanban/__tests__/routes.test.ts`: health/state/task CRUD.
- `src/composables/useKanbanBoard.test.ts`: composable grouping/filter/action behavior.

Create for v0.2:

- `src/server/kanban/auditLog.ts`: append-only hash-chain audit log.
- `src/server/kanban/redaction.ts`: secret redaction.
- `src/server/kanban/remoteAccess.ts`: loopback/remote classification.
- `src/server/kanban/csrf.ts`: same-origin and CSRF mutation guard.
- `src/server/kanban/taskQueue.ts`: one-active-run queue.
- `src/server/kanban/codexBridgeAdapter.ts`: internal bridge wrapper for `thread/start`, `turn/start`, `turn/interrupt`, `review/start`.
- `src/server/kanban/codexKanbanRunner.ts`: run lifecycle.
- `src/server/kanban/worktreeManager.ts`: managed Git worktree creation/reconciliation.
- `src/server/kanban/reviewPacketService.ts`: review packet hashing and artifact indexing.
- `src/server/kanban/proposalService.ts`: inert proposal parse/accept/dismiss.
- `src/server/kanban/commandRisk.ts`: static command risk classifier.
- `src/server/kanban/recoveryService.ts`: startup stale-run classification.
- `src/server/kanban/testRunner.ts`: configured test command runner.
- `src/components/kanban/TaskRunControls.vue`: run/stop/retry controls.
- `src/components/kanban/TaskRunLogPanel.vue`: persisted streaming logs.
- `src/components/kanban/TaskReviewPacketPanel.vue`: packet/test/diff summary.
- `src/components/kanban/TaskProposalList.vue`: inert proposals.
- `src/server/kanban/__tests__/policy.test.ts`: execution blocked by default, remote, unsafe config.
- `src/server/kanban/__tests__/worktreeManager.test.ts`: temp Git repo worktree behavior.
- `src/server/kanban/__tests__/taskQueue.test.ts`: concurrency and cancellation.
- `src/server/kanban/__tests__/auditLog.test.ts`: hash chain and redaction.
- `src/server/kanban/__tests__/reviewPacketService.test.ts`: stale packet hash behavior.

Modify:

- `src/router/index.ts`: add `/kanban`.
- `src/App.vue`: add lazy page import, route predicate, title/accent, sidebar nav item, page render branch.
- `src/server/httpServer.ts`: mount Kanban middleware before the Codex bridge.
- `vite.config.ts`: mount Kanban middleware before dev bridge handlers.
- `src/server/codexAppServerBridge.ts`: expose a narrow internal runtime surface.
- `src/server/reviewGit.ts`: export focused diff helpers when review packets are implemented.
- `src/style.css`: global dark/mobile sheet overrides that cannot live safely in component scope.
- `tests.md`: append manual verification sections for v0.1 and v0.2 as each release lands.

## Shared Types Contract

Use this as the starting content for `src/types/kanban.ts` in Task 1:

```ts
export const KANBAN_STATUSES = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'ready', title: 'Ready' },
  { id: 'running', title: 'Running' },
  { id: 'review', title: 'Review' },
  { id: 'rework', title: 'Rework' },
  { id: 'done', title: 'Done' },
  { id: 'cancelled', title: 'Cancelled' },
] as const

export type KanbanStatus = typeof KANBAN_STATUSES[number]['id']

export type KanbanRunState =
  | 'idle'
  | 'queued'
  | 'preparing_worktree'
  | 'starting_codex'
  | 'running'
  | 'waiting_for_approval'
  | 'running_tests'
  | 'collecting_artifacts'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stalled'
  | 'cancelled'
  | 'needs_recovery'

export type KanbanTaskLabel = {
  id: string
  name: string
  color: string
}

export type KanbanAcceptanceCriterion = {
  id: string
  text: string
  checked: boolean
  createdAtIso: string
  updatedAtIso: string
}

export type KanbanTask = {
  id: string
  boardId: string
  title: string
  description: string
  status: KanbanStatus
  runState: KanbanRunState
  labels: KanbanTaskLabel[]
  acceptanceCriteria: KanbanAcceptanceCriterion[]
  projectRoot: string
  cwd: string
  baseBranch: string
  branchName: string
  worktreeId: string
  worktreePath: string
  codexThreadId: string
  currentRunId: string
  runIds: string[]
  reviewPacketId: string
  proposalIds: string[]
  blockedReason: string
  errorMessage: string
  archived: boolean
  createdAtIso: string
  updatedAtIso: string
  version: number
}

export type KanbanBoard = {
  id: string
  title: string
  projectRoot: string
  createdAtIso: string
  updatedAtIso: string
}

export type KanbanExecutionPolicy = {
  enabled: boolean
  executionEnabled: boolean
  requireLoopbackForExecution: boolean
  disableExecutionWhenRemote: boolean
  sandboxMode: 'workspace-write'
  approvalPolicy: 'on-request'
  networkAccess: false
  allowDangerFullAccess: false
  allowApprovalNever: false
  allowAcceptForSession: false
  useThreadShellCommand: false
  maxGlobalActiveRuns: 1
  maxActiveRunsPerRepo: 1
  maxActiveRunsPerTask: 1
}

export type KanbanStateSnapshot = {
  schemaVersion: 1
  board: KanbanBoard
  tasks: KanbanTask[]
  policy: KanbanExecutionPolicy
  generatedAtIso: string
}

export type CreateKanbanTaskInput = {
  title: string
  description?: string
  labels?: KanbanTaskLabel[]
  acceptanceCriteria?: Array<{ text: string; checked?: boolean }>
}

export type UpdateKanbanTaskInput = Partial<Pick<KanbanTask, 'title' | 'description' | 'labels' | 'blockedReason'>>

export type SetKanbanTaskStatusInput = {
  status: KanbanStatus
  reason?: string
}

export type ReplaceKanbanAcceptanceCriteriaInput = {
  criteria: Array<{ id?: string; text: string; checked?: boolean }>
}

export type KanbanApiResponse<T> = {
  data: T
}

export type KanbanApiError = {
  error: string
}
```

## Task 1: Types, Config, IDs, And Paths

**Files:**

- Create: `src/types/kanban.ts`
- Create: `src/server/kanban/config.ts`
- Create: `src/server/kanban/ids.ts`
- Create: `src/server/kanban/paths.ts`
- Test: `src/server/kanban/__tests__/config.test.ts`

- [ ] **Step 1: Write config tests**

```ts
import { describe, expect, it } from 'vitest'
import { resolveKanbanConfig } from '../config'

describe('resolveKanbanConfig', () => {
  it('keeps execution disabled by default and pins safe Codex policy', () => {
    const config = resolveKanbanConfig({})
    expect(config.policy.executionEnabled).toBe(false)
    expect(config.policy.sandboxMode).toBe('workspace-write')
    expect(config.policy.approvalPolicy).toBe('on-request')
    expect(config.policy.networkAccess).toBe(false)
    expect(config.policy.allowDangerFullAccess).toBe(false)
    expect(config.policy.allowApprovalNever).toBe(false)
  })

  it('enables execution only from CODEXUI_KANBAN_EXECUTION_ENABLED=1', () => {
    const config = resolveKanbanConfig({ CODEXUI_KANBAN_EXECUTION_ENABLED: '1' })
    expect(config.policy.executionEnabled).toBe(true)
  })
})
```

- [ ] **Step 2: Add types and config implementation**

Use the shared `src/types/kanban.ts` contract above. Implement `resolveKanbanConfig(env = process.env)` with these fixed policy values:

```ts
export function resolveKanbanConfig(env: NodeJS.ProcessEnv = process.env) {
  const dataDir = env.CODEXUI_KANBAN_DATA_DIR?.trim() || ''
  return {
    dataDir,
    policy: {
      enabled: true,
      executionEnabled: env.CODEXUI_KANBAN_EXECUTION_ENABLED === '1',
      requireLoopbackForExecution: true,
      disableExecutionWhenRemote: true,
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'on-request' as const,
      networkAccess: false as const,
      allowDangerFullAccess: false as const,
      allowApprovalNever: false as const,
      allowAcceptForSession: false as const,
      useThreadShellCommand: false as const,
      maxGlobalActiveRuns: 1 as const,
      maxActiveRunsPerRepo: 1 as const,
      maxActiveRunsPerTask: 1 as const,
    },
  }
}
```

- [ ] **Step 3: Add ID and path helpers**

`ids.ts` exports `createKanbanId(prefix)` using `node:crypto.randomUUID()` and returns IDs like `task_<uuid-without-dashes>`.

`paths.ts` exports:

```ts
export function resolveKanbanDataDir(configuredDir: string, homeDir = homedir()): string
export function projectHash(projectRoot: string): string
export function resolveProjectStatePath(dataDir: string, projectRoot: string): string
export function resolveProjectRunDir(dataDir: string, projectRoot: string, runId: string): string
```

Default data dir must be `${CODEX_HOME || ~/.codex}/codexui-kanban`.

- [ ] **Step 4: Run the focused test**

Run: `pnpm exec vitest run src/server/kanban/__tests__/config.test.ts`

Expected: config tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/kanban.ts src/server/kanban/config.ts src/server/kanban/ids.ts src/server/kanban/paths.ts src/server/kanban/__tests__/config.test.ts
git commit -m "feat: add kanban type and policy foundation"
```

## Task 2: Atomic Storage And Task Service

**Files:**

- Create: `src/server/kanban/migrations.ts`
- Create: `src/server/kanban/storage.ts`
- Create: `src/server/kanban/schema.ts`
- Create: `src/server/kanban/taskService.ts`
- Test: `src/server/kanban/__tests__/storage.test.ts`

- [ ] **Step 1: Write storage tests**

Cover these behaviors:

- empty state creates one board for the project root
- task creation persists across a new storage instance
- update increments `version`
- archive sets `archived: true` without deleting the task
- invalid/corrupt JSON is copied to `backups/` and raises an operator-visible error

Run target: `pnpm exec vitest run src/server/kanban/__tests__/storage.test.ts`

- [ ] **Step 2: Implement state file shape**

`migrations.ts` exports:

```ts
export type KanbanStateFileV1 = {
  schemaVersion: 1
  projectRoot: string
  createdAtIso: string
  updatedAtIso: string
  boards: Record<string, KanbanBoard>
  tasks: Record<string, KanbanTask>
  runs: Record<string, unknown>
  worktrees: Record<string, unknown>
  reviewPackets: Record<string, unknown>
  proposals: Record<string, unknown>
  approvals: Record<string, unknown>
  settings: Record<string, unknown>
}

export function createEmptyStateFile(projectRoot: string, nowIso: string): KanbanStateFileV1
export function migrateKanbanStateFile(value: unknown, projectRoot: string): KanbanStateFileV1
```

- [ ] **Step 3: Implement atomic mutations**

`storage.ts` exports `KanbanStorage` with:

```ts
export class KanbanStorage {
  constructor(options: { dataDir: string; projectRoot: string })
  load(): Promise<KanbanStateFileV1>
  mutate(mutator: (state: KanbanStateFileV1) => void): Promise<KanbanStateFileV1>
}
```

Write mutation flow:

1. `mkdir -p` state and backup directories.
2. Load current file or create empty state.
3. Apply mutation.
4. Write a unique temporary file derived from the state path, process id, timestamp, and random suffix.
5. Rename tmp to final.

Serialize concurrent `mutate()` calls through a per-instance async queue so read-modify-write operations cannot overwrite each other. If JSON parse or migration validation fails, copy the bad file to `backups/<timestamp>-<projectHash>.json` and throw an operator-visible internal error. The route layer must log the detailed backup path server-side and return a generic `Kanban request failed` message to clients for `500` responses so filesystem paths are not exposed.

- [ ] **Step 4: Implement task service**

`taskService.ts` exports `KanbanTaskService` with:

```ts
listState(): Promise<KanbanStateSnapshot>
createTask(input: CreateKanbanTaskInput): Promise<KanbanTask>
updateTask(taskId: string, input: UpdateKanbanTaskInput): Promise<KanbanTask>
setTaskStatus(taskId: string, input: SetKanbanTaskStatusInput): Promise<KanbanTask>
archiveTask(taskId: string): Promise<KanbanTask>
replaceAcceptanceCriteria(taskId: string, input: ReplaceKanbanAcceptanceCriteriaInput): Promise<KanbanTask>
```

Use explicit status transition validation:

```ts
const ALLOWED_STATUS_TRANSITIONS: Record<KanbanStatus, KanbanStatus[]> = {
  backlog: ['ready', 'cancelled'],
  ready: ['backlog', 'running', 'cancelled'],
  running: ['review', 'rework', 'cancelled'],
  review: ['done', 'rework', 'cancelled'],
  rework: ['ready', 'running', 'cancelled'],
  done: ['review', 'rework'],
  cancelled: ['backlog'],
}
```

Use a single timestamp per create/update operation. Status changes that omit `reason` must preserve the existing `blockedReason`; only an explicit `reason` field should update it.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm exec vitest run src/server/kanban/__tests__/storage.test.ts`

Commit:

```bash
git add src/server/kanban/migrations.ts src/server/kanban/storage.ts src/server/kanban/schema.ts src/server/kanban/taskService.ts src/server/kanban/__tests__/storage.test.ts
git commit -m "feat: persist kanban board state"
```

## Task 3: HTTP Routes And Middleware Mounting

**Files:**

- Create: `src/server/kanban/eventBus.ts`
- Create: `src/server/kanban/routes.ts`
- Create: `src/server/kanban/index.ts`
- Modify: `src/server/httpServer.ts`
- Modify: `vite.config.ts`
- Test: `src/server/kanban/__tests__/routes.test.ts`

- [ ] **Step 1: Write route tests**

Use Express request/response tests or direct middleware invocation consistent with existing server tests. Cover:

- `GET /codex-api/kanban/health` returns `{ data: { ok: true } }`
- `GET /codex-api/kanban/state` returns one board and an empty task list
- `POST /codex-api/kanban/tasks` creates a task
- `POST /codex-api/kanban/tasks/:taskId/status` rejects invalid transition with `400`

- [ ] **Step 2: Implement routes**

v0.1 endpoints:

```text
GET    /codex-api/kanban/health
GET    /codex-api/kanban/state
GET    /codex-api/kanban/events
POST   /codex-api/kanban/tasks
PATCH  /codex-api/kanban/tasks/:taskId
POST   /codex-api/kanban/tasks/:taskId/status
POST   /codex-api/kanban/tasks/:taskId/archive
POST   /codex-api/kanban/tasks/:taskId/criteria/replace
```

All JSON responses use `{ data: ... }` except errors, which use `{ error: "message" }`.
The SSE route must use streaming-friendly headers (`Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`), clean up subscriptions on write/socket errors, and skip subscribing if the initial ready event write has already failed. The event bus should support normal multi-tab fan-out without Node max-listener warnings.

- [ ] **Step 3: Mount in production before the bridge**

In `src/server/httpServer.ts`, import `createKanbanMiddleware` and mount it after auth, before `app.use(bridge)`:

```ts
const kanban = createKanbanMiddleware()

if (authSession) {
  app.use(authSession.middleware)
}

app.use('/codex-api/kanban', kanban)
app.use(bridge)
```

- [ ] **Step 4: Mount in Vite before the dev bridge**

In `vite.config.ts`, create `const kanban = createKanbanMiddleware()` inside `configureServer(server)` and call `server.middlewares.use('/codex-api/kanban', kanban)` before handlers that proxy `/codex-api/*` to the bridge.

- [ ] **Step 5: Run routes test and build smoke**

Run:

```bash
pnpm exec vitest run src/server/kanban/__tests__/routes.test.ts
pnpm run build:frontend
```

Expected: tests pass and frontend typecheck/build completes.

- [ ] **Step 6: Commit**

```bash
git add src/server/kanban/eventBus.ts src/server/kanban/routes.ts src/server/kanban/index.ts src/server/httpServer.ts vite.config.ts src/server/kanban/__tests__/routes.test.ts
git commit -m "feat: add kanban HTTP API"
```

## Task 4: Frontend Gateway And Composable

**Files:**

- Create: `src/api/kanbanGateway.ts`
- Create: `src/composables/useKanbanBoard.ts`
- Test: `src/composables/useKanbanBoard.test.ts`

- [ ] **Step 1: Write composable tests**

Cover:

- state loads through injected gateway
- `tasksByStatus` includes all seven statuses
- search filters by title/description/label
- selected task follows `selectTask`
- `createTask`, `setTaskStatus`, and `archiveTask` refresh state or patch local state consistently
- archived patches clear stale selected task ids
- failed loads clear stale tasks, policy, and selection
- event subscriptions reload board state when Kanban SSE events arrive

- [ ] **Step 2: Implement gateway**

Expose:

```ts
loadKanbanState(): Promise<KanbanStateSnapshot>
createKanbanTask(input: CreateKanbanTaskInput): Promise<KanbanTask>
updateKanbanTask(taskId: string, patch: UpdateKanbanTaskInput): Promise<KanbanTask>
setKanbanTaskStatus(taskId: string, status: KanbanStatus, reason?: string): Promise<KanbanTask>
archiveKanbanTask(taskId: string): Promise<KanbanTask>
replaceKanbanAcceptanceCriteria(taskId: string, criteria: ReplaceKanbanAcceptanceCriteriaInput['criteria']): Promise<KanbanTask>
subscribeKanbanEvents(handler: (event: unknown) => void, options?: { onError?: (error: Event) => void }): () => void
```

Use `fetch()` and normalize non-2xx JSON errors to `Error(message)`. Archive requests must send an explicit empty JSON body. SSE subscribers must tolerate malformed event payloads, report connection errors through the optional handler, and leave browser-native reconnect behavior intact until teardown closes the source.

- [ ] **Step 3: Implement composable**

Expose:

```ts
tasks
tasksByStatus
visibleTasksByStatus
countsByStatus
selectedTaskId
selectedTask
filters
isLoading
errorMessage
executionPolicy
loadBoard
createTask
updateTask
archiveTask
setTaskStatus
selectTask
clearSelection
addAcceptanceCriterion
updateAcceptanceCriterion
removeAcceptanceCriterion
setCriterionChecked
setSearchQuery
toggleLabelFilter
clearFilters
subscribeToEvents
```

Persist only filters to `localStorage` key `codex-web-local.kanban.filters.v1`.
Exclude archived tasks from status groups, visible filtered groups, counts, selected task resolution, and label filter options. `patchTask()` must reconcile selection after updates so an archived selected task clears `selectedTaskId` and any `#/kanban?task=` sync. `loadBoard()` failure must clear stale in-memory board state. `subscribeToEvents()` should use `subscribeKanbanEvents()` and reload the board on incoming Kanban mutation events while leaving EventSource reconnect behavior to the browser.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run src/composables/useKanbanBoard.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/api/kanbanGateway.ts src/composables/useKanbanBoard.ts src/composables/useKanbanBoard.test.ts
git commit -m "feat: add kanban frontend state layer"
```

## Task 5: Route, Sidebar Nav, And Empty Board Page

**Files:**

- Modify: `src/router/index.ts`
- Modify: `src/App.vue`
- Create: `src/components/icons/IconTablerLayoutKanban.vue`
- Create: `src/components/kanban/KanbanBoardPage.vue`
- Create: `src/components/kanban/KanbanEmptyState.vue`

- [ ] **Step 1: Add route**

Add:

```ts
{
  path: '/kanban',
  name: 'kanban',
  component: EmptyRouteView,
}
```

Place it before the catch-all redirect.

- [ ] **Step 2: Add App shell branch**

In `src/App.vue`:

- define `const KanbanBoardPage = defineAsyncComponent(() => import('./components/kanban/KanbanBoardPage.vue'))`
- define `const isKanbanRoute = computed(() => route.name === 'kanban')`
- return `t('Kanban')` from `contentTitle` for Kanban
- set `ContentHeader :accent="isSkillsRoute || isKanbanRoute"`
- render `<KanbanBoardPage />` before the home/thread branches
- add sidebar button near Skills, with `router.push({ name: 'kanban' })` and mobile drawer close
- update `showThreadContextBadge`, route watchers, and terminal toggle predicates so Kanban behaves like Skills and does not require a selected thread
- ensure `pageTitle` uses `Kanban` on the Kanban route instead of retaining a previously selected thread title

- [ ] **Step 3: Build empty page**

`KanbanBoardPage.vue` should call `useKanbanBoard().loadBoard()` on mount and show:

- loading state
- error state with retry
- empty state with create-task action
- execution-disabled banner from policy
- selection sync for `#/kanban?task=<id>`: initialize `selectedTaskId` from the query parameter, update the query when selection changes, and remove the query when selection clears or the task is missing/archived after load
- live event subscription on mount and teardown on unmount, so updates from another tab or local process refresh the board

- [ ] **Step 4: Verify static route behavior**

Run:

```bash
pnpm exec vue-tsc --noEmit
pnpm run build:frontend
```

Manual check:

1. Start `pnpm run dev -- --host 0.0.0.0 --port 4173`.
2. Open `http://127.0.0.1:4173/#/kanban`.
3. Confirm the shell title is `Kanban`, the sidebar nav item is active, and no thread is required.
4. Switch light/dark/system using Settings and confirm the empty page is legible.

- [ ] **Step 5: Commit**

```bash
git add src/router/index.ts src/App.vue src/components/icons/IconTablerLayoutKanban.vue src/components/kanban/KanbanBoardPage.vue src/components/kanban/KanbanEmptyState.vue
git commit -m "feat: add kanban route shell"
```

## Task 6A: v0.1 Board Shell, Columns, And Cards

**Files:**

- Create: `src/components/kanban/KanbanToolbar.vue`
- Create: `src/components/kanban/KanbanBoardViewport.vue`
- Create: `src/components/kanban/KanbanMobileStatusTabs.vue`
- Create: `src/components/kanban/KanbanColumn.vue`
- Create: `src/components/kanban/KanbanTaskCard.vue`
- Modify: `src/components/kanban/KanbanBoardPage.vue`

- [ ] **Step 1: Build desktop board**

Desktop layout:

```text
KanbanToolbar
KanbanBoardViewport
  seven KanbanColumn components
KanbanTaskInspector
```

Each card shows title, description preview, labels, acceptance progress, status/run badge, and a proposal count badge hidden when zero.

- [ ] **Step 2: Build mobile board**

Mobile layout:

```text
KanbanToolbar
KanbanMobileStatusTabs
single selected-status task list
KanbanTaskSheet when selected
```

Do not render a horizontal seven-column board on mobile.
Mobile status tabs must implement roving tabindex keyboard navigation with ArrowLeft, ArrowRight, Home, and End.

- [ ] **Step 3: Run build and commit**

Run:

```bash
pnpm run build:frontend
```

Commit:

```bash
git add src/components/kanban/KanbanToolbar.vue src/components/kanban/KanbanBoardViewport.vue src/components/kanban/KanbanMobileStatusTabs.vue src/components/kanban/KanbanColumn.vue src/components/kanban/KanbanTaskCard.vue src/components/kanban/KanbanBoardPage.vue
git commit -m "feat: render kanban board shell"
```

## Task 6B: v0.1 Task Inspector, Editors, And Manual Verification

**Files:**

- Create: `src/components/kanban/KanbanTaskInspector.vue`
- Create: `src/components/kanban/KanbanTaskSheet.vue`
- Create: `src/components/kanban/TaskSummaryEditor.vue`
- Create: `src/components/kanban/AcceptanceCriteriaEditor.vue`
- Create: `src/components/kanban/TaskStatusActions.vue`
- Modify: `src/components/kanban/KanbanBoardPage.vue`
- Modify: `src/style.css` only for global dark/mobile sheet rules that component styles cannot cover.
- Modify: `tests.md`

- [ ] **Step 1: Add editors and actions**

Implement create/edit/archive, acceptance criteria replace, label editing, and explicit status action buttons using the allowed transition table from Task 2. Label editing must dedupe normalized label ids before saving, and the server parser must generate stable unique label ids for API clients that provide label names without ids. Status updates that omit `reason` must preserve the existing `blockedReason`; only an explicit `reason` field should update it.
Async mutation failures must be caught and surfaced in the page instead of being discarded. The mobile task sheet must behave as a dialog with `role="dialog"`, `aria-modal="true"`, focus-on-open, Escape close, and backdrop click close.

- [ ] **Step 2: Manual verification**

Run `pnpm run dev -- --host 0.0.0.0 --port 4173`.

Verify:

1. Create a task in light mode.
2. Add two acceptance criteria and check one.
3. Move task `Backlog -> Ready -> Running -> Review -> Done`.
4. Refresh the browser and confirm state persists.
5. Restart the dev server and confirm state persists.
6. Open `#/kanban?task=<created-task-id>` and confirm the same task is selected after browser refresh and dev-server restart.
7. Switch to dark mode and repeat create/edit/status flow.
8. Resize to mobile width and confirm status tabs plus full-height sheet behavior, including keyboard navigation and Escape close.

- [ ] **Step 3: Append `tests.md` section**

Add a section named `Kanban Board v0.1 Manual Verification` with prerequisites, exact steps, expected results, light-theme result, dark-theme result, mobile result, and cleanup notes.

- [ ] **Step 4: Run verification commands and commit**

Run:

```bash
pnpm exec vitest run src/server/kanban/__tests__/storage.test.ts src/server/kanban/__tests__/routes.test.ts src/composables/useKanbanBoard.test.ts
pnpm run build:frontend
```

Commit:

```bash
git add src/components/kanban src/style.css tests.md
git commit -m "feat: build kanban board CRUD UI"
```

## Task 7: Safe Execution Policy And Audit Foundation

**Files:**

- Create: `src/server/kanban/remoteAccess.ts`
- Create: `src/server/kanban/csrf.ts`
- Create: `src/server/kanban/auditLog.ts`
- Create: `src/server/kanban/redaction.ts`
- Modify: `src/server/kanban/routes.ts`
- Test: `src/server/kanban/__tests__/policy.test.ts`
- Test: `src/server/kanban/__tests__/auditLog.test.ts`

- [ ] **Step 1: Write policy tests**

Cover:

- `POST /codex-api/kanban/tasks/:taskId/run` returns `403` when execution env flag is absent.
- non-loopback request returns `403` even when execution env flag is enabled.
- mutation without CSRF returns `403` after CSRF is enabled.
- audit append failure prevents a run from starting.

- [ ] **Step 2: Implement remote classification**

Loopback addresses are only:

```text
127.0.0.1
::1
::ffff:127.0.0.1
```

Any `x-forwarded-for`, public LAN, Tailscale, Cloudflared, reverse proxy, or unknown remote address disables execution controls.

- [ ] **Step 3: Implement audit hash chain**

Append JSONL events with:

```ts
schema
eventId
ts
prevEventHash
eventHash
eventType
actor
task
repo
codex
policy
```

Hash the canonical JSON of the event without `eventHash`.

- [ ] **Step 4: Add disabled run endpoint**

Add `POST /codex-api/kanban/tasks/:taskId/run`, but it only performs policy preflight and returns a blocked response until Task 10 wires the runner.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanban/remoteAccess.ts src/server/kanban/csrf.ts src/server/kanban/auditLog.ts src/server/kanban/redaction.ts src/server/kanban/routes.ts src/server/kanban/__tests__/policy.test.ts src/server/kanban/__tests__/auditLog.test.ts
git commit -m "feat: add kanban execution safety gate"
```

## Task 8: Worktree Manager And Queue

**Files:**

- Create: `src/server/kanban/worktreeManager.ts`
- Create: `src/server/kanban/taskQueue.ts`
- Create: `src/server/kanban/recoveryService.ts`
- Test: `src/server/kanban/__tests__/worktreeManager.test.ts`
- Test: `src/server/kanban/__tests__/taskQueue.test.ts`

- [ ] **Step 1: Write temp Git repo tests**

Use `mkdtemp`, `git init`, `git commit --allow-empty`, and `git worktree list --porcelain` in the test setup. Verify:

- branch names are `codexui/task/<taskId>-<slug>`
- worktree path lives under Kanban managed root
- existing active worktree blocks a second active run for the same task
- dirty worktree cleanup is refused

- [ ] **Step 2: Implement worktree creation**

Rules:

- resolve project root with `git rev-parse --show-toplevel`
- base branch order: configured value, `origin/HEAD`, `main`, `master`
- sanitize slug to `[a-z0-9-]`
- never run directly on `main`
- write lock metadata with run ID, PID, task ID, heartbeat timestamp

- [ ] **Step 3: Implement queue**

Concurrency is fixed at one global active run, one active run per repo, one active run per task.

- [ ] **Step 4: Commit**

```bash
git add src/server/kanban/worktreeManager.ts src/server/kanban/taskQueue.ts src/server/kanban/recoveryService.ts src/server/kanban/__tests__/worktreeManager.test.ts src/server/kanban/__tests__/taskQueue.test.ts
git commit -m "feat: add kanban worktree queue"
```

## Task 9: Internal Codex Bridge Adapter

**Files:**

- Modify: `src/server/codexAppServerBridge.ts`
- Create: `src/server/kanban/codexBridgeAdapter.ts`
- Test: `src/server/kanban/__tests__/codexBridgeAdapter.test.ts`

- [ ] **Step 1: Expose narrow bridge runtime**

Add an exported type:

```ts
export type CodexBridgeRuntime = {
  rpc<T = unknown>(method: string, params?: unknown): Promise<T>
  subscribeNotifications(listener: (value: { method: string; params: unknown; atIso: string }) => void): () => void
  dispose(): void
}
```

Keep public HTTP behavior unchanged.

- [ ] **Step 2: Pass bridge runtime into Kanban middleware**

Update `createKanbanMiddleware({ bridge })` so production and dev share the existing app-server child process.

- [ ] **Step 3: Implement adapter**

Allowed app-server methods:

```text
thread/start
thread/resume
turn/start
turn/interrupt
review/start
command/exec
```

Explicitly reject `thread/shellCommand`.

- [ ] **Step 4: CJS smoke requirement**

Because this changes server module loading behavior in an ESM package, do not use `require('./dist-cli/index.js')` as the primary smoke. Run:

```bash
pnpm run build
node -e "import('./dist-cli/index.js').then(() => console.log('dist-cli import ok'))"
node -e "import('./dist/server/codexAppServerBridge.js').then((mod) => console.log(typeof mod.createCodexBridgeMiddleware))"
```

If the emitted server path differs, inspect `dist/` and run the closest import-based smoke for the changed server entry. Record the exact command in the completion report.

- [ ] **Step 5: Commit**

```bash
git add src/server/codexAppServerBridge.ts src/server/kanban/codexBridgeAdapter.ts src/server/kanban/__tests__/codexBridgeAdapter.test.ts
git commit -m "feat: expose kanban codex bridge adapter"
```

## Task 10: Runner, Logs, Interrupt, And UI Controls

**Files:**

- Create: `src/server/kanban/codexKanbanRunner.ts`
- Create: `src/components/kanban/TaskRunControls.vue`
- Create: `src/components/kanban/TaskRunLogPanel.vue`
- Modify: `src/server/kanban/routes.ts`
- Modify: `src/api/kanbanGateway.ts`
- Modify: `src/composables/useKanbanBoard.ts`
- Modify: `src/components/kanban/KanbanTaskInspector.vue`
- Modify: `src/components/kanban/KanbanTaskSheet.vue`

- [ ] **Step 1: Implement runner flow**

Run start flow:

1. Policy preflight.
2. Audit `run.queued`.
3. Create managed worktree.
4. `thread/start` or `thread/resume`.
5. `turn/start` with `cwd = worktreePath`, sandbox `workspace-write`, approval `on-request`, network disabled.
6. Persist notifications to `events.jsonl`.
7. Persist log deltas to log files.
8. On completion, capture `git status` and diff.
9. Move task to `review` and generate review packet in Task 11.

- [ ] **Step 2: Implement interrupt**

`POST /codex-api/kanban/runs/:runId/interrupt` marks run `stopping`, calls `turn/interrupt`, preserves the worktree, writes audit events, and moves to `cancelled` or `needs_recovery`.

- [ ] **Step 3: Implement log routes**

Add:

```text
GET /codex-api/kanban/runs/:runId
GET /codex-api/kanban/runs/:runId/logs
GET /codex-api/kanban/runs/:runId/events
```

- [ ] **Step 4: Add UI controls**

Show Run controls only when policy says local execution is available. Remote/tunnel sessions show a disabled banner and cannot start or approve runs.

- [ ] **Step 5: Tests and commit**

Add unit tests with a fake bridge runtime. Do not call real Codex in unit tests.

Commit:

```bash
git add src/server/kanban/codexKanbanRunner.ts src/components/kanban/TaskRunControls.vue src/components/kanban/TaskRunLogPanel.vue src/server/kanban/routes.ts src/api/kanbanGateway.ts src/composables/useKanbanBoard.ts src/components/kanban/KanbanTaskInspector.vue src/components/kanban/KanbanTaskSheet.vue
git commit -m "feat: run kanban tasks through codex safely"
```

## Task 11: Review Packets, Rework, And Proposals

**Files:**

- Create: `src/server/kanban/reviewPacketService.ts`
- Create: `src/server/kanban/proposalService.ts`
- Create: `src/server/kanban/testRunner.ts`
- Create: `src/components/kanban/TaskReviewPacketPanel.vue`
- Create: `src/components/kanban/TaskProposalList.vue`
- Modify: `src/server/reviewGit.ts`
- Modify: `src/server/kanban/routes.ts`
- Test: `src/server/kanban/__tests__/reviewPacketService.test.ts`

- [ ] **Step 1: Export reusable review helpers**

From `src/server/reviewGit.ts`, export focused helpers for Git root detection, base branch detection, and diff snapshot generation. Keep existing review routes working.

- [ ] **Step 2: Generate review packet**

Packet hash includes:

```text
task.updatedAtIso
run.id
base commit
head commit
raw diff patch
test command IDs and exit codes
approval/proposal unresolved state
```

- [ ] **Step 3: Add review routes**

```text
GET  /codex-api/kanban/tasks/:taskId/review-packet
POST /codex-api/kanban/tasks/:taskId/review-packet/regenerate
POST /codex-api/kanban/tasks/:taskId/rework
POST /codex-api/kanban/tasks/:taskId/review/approve
POST /codex-api/kanban/tasks/:taskId/review/reject
```

Approval means "mark task done" in v0. It does not merge or push.

- [ ] **Step 4: Add proposal routes**

```text
GET  /codex-api/kanban/proposals
POST /codex-api/kanban/proposals/:proposalId/accept
POST /codex-api/kanban/proposals/:proposalId/reject
```

Accepted agent-created task proposals become human-promoted backlog tasks. They do not run until a human starts them.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanban/reviewPacketService.ts src/server/kanban/proposalService.ts src/server/kanban/testRunner.ts src/components/kanban/TaskReviewPacketPanel.vue src/components/kanban/TaskProposalList.vue src/server/reviewGit.ts src/server/kanban/routes.ts src/server/kanban/__tests__/reviewPacketService.test.ts
git commit -m "feat: add kanban review packets and proposals"
```

## Task 12: v0.2 Hardening, Recovery, Docs, And Final Verification

**Files:**

- Create: `src/server/kanban/commandRisk.ts`
- Modify: `src/server/kanban/recoveryService.ts`
- Modify: `src/server/kanban/worktreeManager.ts`
- Modify: `src/server/kanban/routes.ts`
- Modify: `src/style.css`
- Modify: `tests.md`

- [ ] **Step 1: Add command risk classifier**

Flag these command patterns:

```text
rm -rf
git reset --hard
git clean
git checkout -f
git push --force
chmod -R
chown -R
sudo
docker prune
kubectl delete
terraform apply
terraform destroy
curl ... | sh
wget ... | sh
npm publish
```

- [ ] **Step 2: Add startup recovery**

On server start, classify active records as still running, crashed cleanly, crashed with changes, orphaned process, awaiting approval, or stuck. Never auto-delete dirty worktrees.

- [ ] **Step 3: Add cleanup confirmation**

Worktree cleanup requires local loopback, CSRF, typed confirmation, clean worktree, audit event, and no active run.

- [ ] **Step 4: Append `tests.md` v0.2 section**

Add `Kanban Safe Execution v0.2 Manual Verification` with exact local-only setup, dark/light UI checks, remote-blocking check, interrupt check, review packet check, and cleanup notes.

- [ ] **Step 5: Full verification**

Run:

```bash
pnpm exec vitest run src/server/kanban/__tests__/config.test.ts src/server/kanban/__tests__/storage.test.ts src/server/kanban/__tests__/routes.test.ts src/server/kanban/__tests__/policy.test.ts src/server/kanban/__tests__/worktreeManager.test.ts src/server/kanban/__tests__/taskQueue.test.ts src/server/kanban/__tests__/auditLog.test.ts src/server/kanban/__tests__/reviewPacketService.test.ts src/composables/useKanbanBoard.test.ts
pnpm run build
```

Manual UI verification is required in both light and dark theme. Playwright screenshots are required only if the user explicitly asks for Playwright/browser automation.

- [ ] **Step 6: Commit**

```bash
git add src/server/kanban/commandRisk.ts src/server/kanban/recoveryService.ts src/server/kanban/worktreeManager.ts src/server/kanban/routes.ts src/style.css tests.md
git commit -m "feat: harden kanban execution recovery"
```

## Final Acceptance Criteria

v0.1 is complete only when:

- `#/kanban` loads in the existing shell.
- Sidebar nav works on desktop and mobile.
- Seven desktop columns render.
- Mobile uses status tabs and a full-height detail sheet.
- Create/edit/status/archive persists across browser refresh and server restart.
- `#/kanban?task=<id>` opens the selected task.
- No external task manager or new state library is added.
- Light and dark manual verification are documented in `tests.md`.

v0.2 is complete only when:

- Execution is disabled unless `CODEXUI_KANBAN_EXECUTION_ENABLED=1`.
- Non-loopback sessions cannot start runs, approve commands, clean worktrees, merge, push, or create PRs.
- Runs use managed worktrees and never run directly on `main`.
- One active run limit is enforced globally, per repo, and per task.
- Codex uses `thread/start` or `thread/resume`, then `turn/start`.
- Codex execution uses `workspace-write`, `on-request`, network disabled.
- `thread/shellCommand` is not used by Kanban.
- Logs and audit records persist before execution actions.
- Interrupt preserves the worktree and records final state.
- Completed runs move to `Review`, not `Done`.
- Review packet hashes invalidate stale approvals.
- Proposals are inert until human accepted.
- Dirty worktrees are never deleted automatically.
- `tests.md` includes exact light/dark/manual verification evidence.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-kanban-board.md`.

Recommended implementation mode: `superpowers:subagent-driven-development`, one task per agent or inline batch, with human review after Task 6 before safe execution work begins.
