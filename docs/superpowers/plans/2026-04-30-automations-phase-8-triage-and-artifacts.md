# Automations Phase 8 Triage And Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automation run result classification, read/archive triage state, and indexed automation artifacts without making Automations a Kanban subfeature.

**Architecture:** Persist triage fields on each `AutomationRun` so the run store remains the source of truth. Add an automation artifact provider to `WorkspaceArtifactIndex` and route artifact content through indexed descriptors so raw/preview reads stay limited to paths the provider emitted.

**Tech Stack:** TypeScript, Express, Vitest, Vue composables/API gateway, existing `WorkspaceArtifactIndex`, existing automation native/run stores.

---

## File Map

- `src/types/automations.ts`: add `completed_with_findings`, persisted triage fields, and optional projection reference fields to `AutomationRun`; enable `artifactIndexing`.
- `src/server/automations/resultClassifier.ts`: classify completed assistant text as findings or no-findings and produce inbox text.
- `src/server/automations/runStore.ts`: normalize legacy run records that lack triage/reference fields.
- `src/server/automations/runner.ts`: write classified completion state and unread failure state.
- `src/server/automations/service.ts`: expose run triage mutations and report `artifactIndexing: true`.
- `src/server/automations/routes.ts`: add CSRF-protected read/archive/unarchive run endpoints.
- `src/api/automationsGateway.ts`: add client functions for triage endpoints.
- `src/composables/useAutomations.ts`: expose triage actions and refresh run history.
- `src/server/artifacts/artifactIndex.ts`: let providers optionally resolve artifact content and filter by `automationId`.
- `src/server/artifacts/routes.ts`: accept `source=automation`, `automationId=...`, and use provider content resolvers before legacy Kanban fallback.
- `src/server/artifacts/adapters/automationArtifacts.ts`: create the automation artifact provider.
- `src/server/artifacts/adapters/kanbanArtifacts.ts`: optionally provide content resolution for Kanban artifacts using the existing route behavior.
- Tests:
  - `src/server/automations/__tests__/resultClassifier.test.ts`
  - `src/server/automations/__tests__/runStore.test.ts`
  - `src/server/automations/__tests__/routes.test.ts`
  - `src/server/automations/__tests__/runner.test.ts`
  - `src/server/artifacts/__tests__/artifactIndex.test.ts`
  - `src/server/artifacts/__tests__/routes.test.ts`
  - `src/api/automationsGateway.test.ts`
  - `src/composables/useAutomations.test.ts`
- `tests.md`: append manual verification for triage and automation artifact indexing.

## Slice 8A: Result Classification And Triage

**Files:**
- Create: `src/server/automations/resultClassifier.ts`
- Create: `src/server/automations/__tests__/resultClassifier.test.ts`
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/runStore.ts`
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/routes.ts`
- Modify: `src/server/automations/__tests__/runStore.test.ts`
- Modify: `src/server/automations/__tests__/runner.test.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`
- Modify: `src/server/automations/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add failing classifier tests**

Add tests that assert:

```ts
expect(classifyAutomationRunResult('RESULT: FINDINGS\n- Disk is full')).toMatchObject({
  state: 'completed_with_findings',
  findings: true,
  inboxTitle: 'Findings reported',
})
expect(classifyAutomationRunResult('RESULT: NO_FINDINGS\nNothing changed.')).toMatchObject({
  state: 'completed_no_findings',
  findings: false,
})
expect(classifyAutomationRunFailure('Bridge failed')).toMatchObject({
  state: 'failed',
  findings: true,
  inboxTitle: 'Run failed',
})
```

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/resultClassifier.test.ts
```

Expected before implementation: import/module failure.

- [ ] **Step 2: Implement classifier**

Create `resultClassifier.ts` with:

```ts
import type { AutomationRunState } from '../../types/automations'

export type AutomationRunClassification = {
  state: AutomationRunState
  findings: boolean
  inboxTitle: string
  inboxSummary: string
}

export function classifyAutomationRunResult(text: string): AutomationRunClassification {
  const normalized = text.trim()
  const hasFindings = /\bRESULT:\s*(FINDINGS|FOUND|ACTION_REQUIRED)\b/iu.test(normalized)
    || (/\bfindings?\s*:/iu.test(normalized) && !/\bfindings?\s*:\s*(none|no\b|0\b)/iu.test(normalized))
  return {
    state: hasFindings ? 'completed_with_findings' : 'completed_no_findings',
    findings: hasFindings,
    inboxTitle: hasFindings ? 'Findings reported' : 'No findings',
    inboxSummary: summarizeInboxText(normalized || 'Automation completed.'),
  }
}

export function classifyAutomationRunFailure(message: string): AutomationRunClassification {
  return {
    state: 'failed',
    findings: true,
    inboxTitle: 'Run failed',
    inboxSummary: summarizeInboxText(message || 'Automation run failed.'),
  }
}

function summarizeInboxText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 240)
}
```

- [ ] **Step 3: Extend run types and legacy normalization**

Update `AutomationRunState` to include `completed_with_findings`. Add these fields to `AutomationRun`:

```ts
findings: boolean | null
inboxTitle: string
inboxSummary: string
readAtIso: string | null
archivedAtIso: string | null
kanbanTaskId: string | null
reviewPacketId: string | null
proposalIds: string[]
```

Update `parseRun()` so legacy records normalize missing fields to `null`, `''`, or `[]` without dropping existing run data. Extend the legacy test to assert the normalized fields.

- [ ] **Step 4: Classify runner completions and failures**

In `runner.ts`, call `classifyAutomationRunResult(resultSummary)` before updating a completed run. Persist:

```ts
state: classification.state
findings: classification.findings
inboxTitle: classification.inboxTitle
inboxSummary: classification.inboxSummary
readAtIso: classification.findings ? null : now
archivedAtIso: null
```

For every path that writes `state: 'failed'`, use `classifyAutomationRunFailure(message)` and persist unread failure triage fields alongside the failed state. This includes:

- the `startRun()` catch block for startup/bridge failures
- the `completeMatchingRun()` catch block when `thread/read` fails
- `failOrphanedActiveRuns()` for manual runs left active by a previous server session
- `AutomationsService.recoverInterruptedRuns()` for scheduled/manual runs recovered on server startup

Add or extend tests so `runner.test.ts` covers bridge/read/orphan failures and `routes.test.ts` or scheduler/service tests cover `recoverInterruptedRuns()` returning failed runs with:

```ts
findings: true
inboxTitle: 'Run failed'
readAtIso: null
archivedAtIso: null
```

- [ ] **Step 5: Add triage service and routes**

Add service methods:

```ts
markRunRead(automationId: string, runId: string): Promise<AutomationRun>
archiveRun(automationId: string, runId: string): Promise<AutomationRun>
unarchiveRun(automationId: string, runId: string): Promise<AutomationRun>
```

Each method must resolve the automation entry first, update only that automation's run store, and throw `AutomationNotFoundError` when the automation is missing. Missing run IDs should return route `404` with `Automation run not found`.

Add CSRF-protected routes:

```text
POST /codex-api/automations/:automationId/runs/:runId/read
POST /codex-api/automations/:automationId/runs/:runId/archive
POST /codex-api/automations/:automationId/runs/:runId/unarchive
```

- [ ] **Step 6: Verify and commit Slice 8A**

Also update any direct `AutomationRun` fixtures in `src/server/automations/__tests__/scheduler.test.ts` so `pnpm run build` does not fail on missing required triage fields.

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/resultClassifier.test.ts src/server/automations/__tests__/runStore.test.ts src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/scheduler.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/types/automations.ts src/server/automations/resultClassifier.ts src/server/automations/runStore.ts src/server/automations/runner.ts src/server/automations/service.ts src/server/automations/routes.ts src/server/automations/__tests__/resultClassifier.test.ts src/server/automations/__tests__/runStore.test.ts src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/scheduler.test.ts
git commit -m "feat(automations): add run triage state"
```

## Slice 8B: Automation Artifact Provider

**Files:**
- Create: `src/server/artifacts/adapters/automationArtifacts.ts`
- Modify: `src/types/workspaceArtifacts.ts`
- Modify: `src/server/artifacts/artifactIndex.ts`
- Modify: `src/server/artifacts/routes.ts`
- Modify: `src/server/artifacts/adapters/kanbanArtifacts.ts`
- Modify: `src/server/httpServer.ts`
- Modify: `src/api/codexGateway.ts`
- Modify: `src/server/artifacts/__tests__/artifactIndex.test.ts`
- Modify: `src/server/artifacts/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing artifact index tests**

Add a test that creates a temporary `$CODEX_HOME/automations/daily-check/runs/run_1/run.json`, `run.log`, and `events.jsonl`, then asserts:

```ts
const artifacts = await index.listArtifacts({ source: 'automation', automationId: 'daily-check' })
expect(artifacts.map((artifact) => artifact.kind)).toEqual(['run_metadata', 'evidence', 'worktree'])
expect(await index.getArtifact('automation:evidence:daily-check:run_1')).toMatchObject({
  source: 'automation',
  kind: 'evidence',
  automationId: 'daily-check',
  runId: 'run_1',
  logPath,
  eventsPath,
})
```

- [ ] **Step 2: Extend workspace artifact contracts**

Update `WorkspaceArtifactSource`:

```ts
export type WorkspaceArtifactSource = 'thread' | 'kanban' | 'automation'
```

Add `automationId?: string` to `WorkspaceArtifactBase`, run/evidence/worktree/review/proposal artifact variants, and `WorkspaceArtifactQuery`.

Update query parsing in `routes.ts` and response normalization in `src/api/codexGateway.ts` so `source=automation` and `automationId` survive round trips.

Query validation must reject malformed filters instead of silently ignoring them:

```text
GET /codex-api/artifacts?source=nope -> 400 Invalid artifact source
GET /codex-api/artifacts?kind=nope -> 400 Invalid artifact kind
GET /codex-api/artifacts?automationId=../daily -> 400 Invalid automationId
```

Valid `automationId` filters may contain alphanumeric characters, dot, dash, underscore, and colon-free safe IDs only. Add route tests that invalid filters return `400`, and that `source=automation&automationId=daily-check` returns only automation artifacts for that automation.

- [ ] **Step 3: Add optional provider content resolution**

Extend `WorkspaceArtifactProvider` with:

```ts
resolveArtifactContent?: (artifact: WorkspaceArtifact, options?: { maxBytes?: number }) => Promise<WorkspaceArtifactContent | null>
```

Add `WorkspaceArtifactContent` to `artifactIndex.ts` with `contentType`, `filename`, `body`, and `encoding`. Add `WorkspaceArtifactIndex.resolveArtifactContent(artifact, options)` that calls the provider whose `source` matches `artifact.source`.

- [ ] **Step 4: Implement automation provider**

`createAutomationWorkspaceArtifactProvider(options?: NativeAutomationStoreOptions)` must:

- list native automation entries with `listNativeAutomationEntries(options)`
- list each entry's runs with `createAutomationRunStore(entry.automationDirPath).listRuns()`
- emit `automation:run:<automationId>:<runId>` for every run
- emit `automation:evidence:<automationId>:<runId>` when `logPath` or `eventsPath` exists
- emit `automation:worktree:<automationId>:<runId>` when `worktreePath` exists
- emit `automation:review_packet:<automationId>:<runId>` when `reviewPacketId` exists
- emit one `automation:proposal:<automationId>:<runId>:<proposalId>` for each `proposalIds` item

The provider content resolver must return JSON for run/worktree/review/proposal descriptors and read evidence only from the descriptor's indexed `logPath` or `eventsPath`.

- [ ] **Step 5: Wire artifact routes without weakening path checks**

Extend the router option type explicitly:

```ts
export type CreateArtifactRouterOptions = {
  storage: KanbanStorage
  automations?: NativeAutomationStoreOptions
  index?: WorkspaceArtifactIndex
  audit?: (event: ArtifactAccessAuditEvent) => void
}
```

Default `createArtifactRouter()` should build:

```ts
new WorkspaceArtifactIndex([
  createKanbanWorkspaceArtifactProvider(options.storage),
  createAutomationWorkspaceArtifactProvider(options.automations),
])
```

In `src/server/httpServer.ts`, keep the existing default behavior by creating artifacts with:

```ts
const artifacts = createArtifactRouter({ storage: kanbanStorage })
```

Do not pass the `AutomationsService` instance into the artifact router; the provider should read persisted automation/run records through `NativeAutomationStoreOptions` so artifact indexing remains provider-based.

For preview/raw/download, call `index.resolveArtifactContent(artifact, { maxBytes })` before the existing Kanban fallback. Evidence content must still call `assertIndexedArtifactPath(artifact, filePath)` and must ignore any request `path` query.

- [ ] **Step 6: Verify and commit Slice 8B**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/artifacts/__tests__/artifactIndex.test.ts src/server/artifacts/__tests__/routes.test.ts src/api/codexGateway.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/types/workspaceArtifacts.ts src/server/artifacts/artifactIndex.ts src/server/artifacts/routes.ts src/server/artifacts/adapters/kanbanArtifacts.ts src/server/artifacts/adapters/automationArtifacts.ts src/server/httpServer.ts src/api/codexGateway.ts src/server/artifacts/__tests__/artifactIndex.test.ts src/server/artifacts/__tests__/routes.test.ts src/api/codexGateway.test.ts
git commit -m "feat(automations): index run artifacts"
```

## Slice 8C: Client Triage Surface And Manual Test Notes

**Files:**
- Modify: `src/api/automationsGateway.ts`
- Modify: `src/composables/useAutomations.ts`
- Modify: `src/api/automationsGateway.test.ts`
- Modify: `src/composables/useAutomations.test.ts`
- Modify: `tests.md`

- [ ] **Step 1: Add API gateway and composable tests**

Assert the gateway calls these CSRF-protected routes:

```text
POST /codex-api/automations/daily-check/runs/run_1/read
POST /codex-api/automations/daily-check/runs/run_1/archive
POST /codex-api/automations/daily-check/runs/run_1/unarchive
```

Assert `useAutomations` exposes `markRunRead`, `archiveRun`, and `unarchiveRun`, refreshes the selected run history, and preserves `selectedAutomationId`.

- [ ] **Step 2: Implement client functions**

Add gateway functions:

```ts
markAutomationRunRead(automationId: string, runId: string): Promise<AutomationRun>
archiveAutomationRun(automationId: string, runId: string): Promise<AutomationRun>
unarchiveAutomationRun(automationId: string, runId: string): Promise<AutomationRun>
```

Add matching composable methods that call the gateway, then `loadRunHistory(automationId)`.

- [ ] **Step 3: Update `tests.md`**

Append a section named `Automations Phase 8 - Triage and artifact indexing` with:

- prerequisites/setup for a disposable automation and run
- exact manual actions for read/archive/unarchive
- artifact route checks for `source=automation`, preview, raw, and ignored `path=/etc/passwd`
- expected results
- cleanup notes for temporary `$CODEX_HOME/automations/<id>/runs/` artifacts

- [ ] **Step 4: Verify and commit Slice 8C**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts src/server/automations/__tests__/routes.test.ts src/server/artifacts/__tests__/routes.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/api/automationsGateway.ts src/composables/useAutomations.ts src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts tests.md
git commit -m "feat(automations): expose run triage actions"
```

## Phase 8 Final Verification

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/resultClassifier.test.ts src/server/automations/__tests__/runStore.test.ts src/server/automations/__tests__/runner.test.ts src/server/automations/__tests__/routes.test.ts src/server/artifacts/__tests__/artifactIndex.test.ts src/server/artifacts/__tests__/routes.test.ts src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
pnpm run build
git diff --check
```

Then dispatch a spec reviewer and a code-quality reviewer for the full Phase 8 diff before moving to Phase 9.
