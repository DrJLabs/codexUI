# Automations Phase 5 Shared Execution Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Kanban-owned execution primitives into neutral shared modules without changing Kanban behavior or adding automation execution.

**Architecture:** Add shared `src/types/execution.ts` and `src/server/execution/*` modules, then keep existing Kanban module names as compatibility wrappers. Each sub-slice must have focused tests plus a Kanban regression check before the next primitive moves. No scheduler, manual run API, run history UI, artifact source expansion, or automation runner is introduced in this phase.

**Tech Stack:** TypeScript server modules, Vitest, existing Kanban storage/runner/worktree tests.

---

## Scope

In scope:

- Move `CodexRunProfile` and related run-profile normalization into shared execution types/modules.
- Move restricted Codex bridge adapter shape into a shared execution module while preserving the Kanban wrapper and error wording.
- Generalize the in-memory run queue around owner keys while preserving `KanbanTaskQueue`.
- Generalize audit log records to a new schema with `source`, preserving hash-chain compatibility with existing v1 Kanban audit records.
- Add owner metadata to managed worktree locks while keeping existing Kanban task/run fields and lock file location compatible.
- Link this plan from the high-level Automations plan and add `tests.md` verification notes.

Out of scope:

- Manual automation run support.
- Scheduler or recovery behavior changes.
- Artifact `WorkspaceArtifactSource = 'automation'`.
- Moving Kanban runner behavior or storage shape beyond compatibility-preserving fields.
- Renaming existing Kanban API routes or response fields.

## File Structure

- Create: `src/types/execution.ts`
  - Shared `CodexRunProfile`, run-profile mode unions, execution source/owner types, and `CodexTurnStartRunSettings`.
- Modify: `src/types/kanban.ts`
  - Re-export shared run-profile types so existing imports keep working.
- Modify: `src/types/localActions.ts`
  - Import `CodexRunProfile` from shared execution types.
- Modify: `src/server/actions/actionRegistry.ts`
  - Import `CodexRunProfile` from shared execution types.
- Modify: `src/server/reviewPackets/freshness.ts`
  - Import `CodexRunProfile` from shared execution types while keeping `KanbanReviewPacket` Kanban-owned.
- Modify: `src/server/actions/__tests__/actionRegistry.test.ts`
  - Import `CodexRunProfile` from shared execution types.
- Modify: `src/server/artifacts/__tests__/routes.test.ts`
  - Import `CodexRunProfile` from shared execution types while keeping Kanban run/task imports Kanban-owned.
- Create: `src/server/execution/runProfiles.ts`
  - Shared built-in profiles, normalization, id resolution, assertions, effective profile resolver, and Codex turn settings mapping.
- Modify: `src/server/kanban/runProfiles.ts`
  - Compatibility wrapper around shared run-profile functions/constants.
- Create: `src/server/execution/__tests__/runProfiles.test.ts`
  - Shared run-profile coverage.
- Create: `src/server/execution/codexBridgeAdapter.ts`
  - Restricted bridge adapter factory with configurable label and allowed methods.
- Modify: `src/server/kanban/codexBridgeAdapter.ts`
  - Delegate to shared restricted adapter.
- Create: `src/server/execution/__tests__/codexBridgeAdapter.test.ts`
  - Generic adapter tests.
- Create: `src/server/execution/runQueue.ts`
  - Shared owner-key based run queue.
- Modify: `src/server/kanban/taskQueue.ts`
  - Keep `KanbanTaskQueue` wrapper over shared queue using owner key `kanban:task:<taskId>`.
- Create: `src/server/execution/__tests__/runQueue.test.ts`
  - Shared queue tests for global/repo/owner limits.
- Modify: `src/server/kanban/__tests__/taskQueue.test.ts`
  - Add one regression proving Kanban duplicate task wording remains.
- Create: `src/server/execution/auditLog.ts`
  - Shared hash-chained audit log with schema `codexui.execution.audit.v1` and `source`.
- Modify: `src/server/kanban/auditLog.ts`
  - Kanban wrapper writes `source: 'kanban'` records through shared audit log and still reads previous v1 event hashes.
- Create: `src/server/execution/__tests__/auditLog.test.ts`
  - Generic source/hash/redaction tests and legacy v1 previous-hash test.
- Modify: `src/server/kanban/__tests__/auditLog.test.ts`
  - Update expectations for new schema/source while preserving redaction.
- Create: `src/server/workspaces/worktreeLocks.ts`
  - Shared lock filename, owner type, lock normalization, and lock root helper.
- Modify: `src/server/kanban/worktreeManager.ts`
  - Add owner metadata to new locks, use owner metadata for active-lock checks, keep `taskId` and `runId`.
- Modify: `src/server/workspaces/worktreeService.ts`
  - Read shared lock filename/root and expose owner metadata with backward compatibility for old locks.
- Modify: `src/types/worktree.ts`
  - Add `owner` to `WorkspaceWorktree` while retaining `taskId`.
- Modify: `src/server/kanban/__tests__/worktreeManager.test.ts`
  - Cover owner metadata and legacy `taskId` compatibility.
- Modify: `src/server/workspaces/__tests__/worktreeService.test.ts`
  - Cover workspace listing/cleanup compatibility for owner metadata and legacy locks.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Link this Phase 5 implementation plan.
- Modify: `tests.md`
  - Add Phase 5 verification section.

## Fixed Kanban Primitive Regression Suite

Run the focused slice tests in each slice, then run this fixed regression suite before the final Phase 5 commit:

```bash
pnpm exec vitest run \
  src/server/kanban/__tests__/codexKanbanRunner.test.ts \
  src/server/kanban/__tests__/taskQueue.test.ts \
  src/server/kanban/__tests__/auditLog.test.ts \
  src/server/kanban/__tests__/worktreeManager.test.ts \
  src/server/workspaces/__tests__/worktreeService.test.ts \
  src/server/kanban/__tests__/policy.test.ts \
  src/server/kanban/__tests__/reviewPacketService.test.ts \
  src/server/kanban/__tests__/startupRecovery.test.ts \
  src/server/kanban/__tests__/recoveryService.test.ts \
  src/server/kanban/__tests__/routes.test.ts \
  src/server/kanban/__tests__/taskService.test.ts
```

This suite is intentionally Kanban-heavy because Phase 5 must be behavior-preserving extraction, not automation execution.

## Commit Boundaries

- Commit this implementation plan and the high-level-plan link before code changes: `docs(automations): plan phase 5 extraction`.
- Commit each implementation slice separately after its slice tests pass.
- Commit `tests.md` observed results in a final docs-only Phase 5 verification commit if no implementation slice naturally owns those notes.

## Slice 5A: Shared Run Profiles

**Files:**
- Create: `src/types/execution.ts`
- Create: `src/server/execution/runProfiles.ts`
- Create: `src/server/execution/__tests__/runProfiles.test.ts`
- Modify: `src/types/kanban.ts`
- Modify: `src/types/localActions.ts`
- Modify: `src/server/actions/actionRegistry.ts`
- Modify: `src/server/reviewPackets/freshness.ts`
- Modify: `src/server/actions/__tests__/actionRegistry.test.ts`
- Modify: `src/server/artifacts/__tests__/routes.test.ts`
- Modify: `src/server/kanban/runProfiles.ts`

- [ ] **Step 1: Write failing shared run-profile tests**
  - Built-ins include the existing `workspace-coding` default and `full-access-operator` ids.
  - Custom profiles override built-ins by id.
  - Invalid profile input is ignored.
  - Workspace-write settings include worktree path and custom writable roots.
  - Effective profile resolver can accept task override fields without importing Kanban task types.

- [ ] **Step 2: Implement shared types and run-profile module**
  - Move unions and `CodexRunProfile` into `src/types/execution.ts`.
  - Implement neutral helpers:
    - `DEFAULT_CODEX_RUN_PROFILE_ID`
    - `FULL_ACCESS_CODEX_RUN_PROFILE_ID`
    - `BUILTIN_CODEX_RUN_PROFILES`
    - `normalizeCodexRunProfiles`
    - `normalizeCodexRunProfileId`
    - `assertKnownCodexRunProfile`
    - `resolveEffectiveCodexRunProfile`
    - `resolveCodexTurnStartRunSettings`

- [ ] **Step 3: Keep Kanban compatibility exports**
  - Re-export run-profile types from `src/types/kanban.ts`.
  - Migrate neutral/non-Kanban consumers to `src/types/execution.ts`: `src/types/localActions.ts`, `src/server/actions/actionRegistry.ts`, `src/server/reviewPackets/freshness.ts`, `src/server/actions/__tests__/actionRegistry.test.ts`, and the `CodexRunProfile` import in `src/server/artifacts/__tests__/routes.test.ts`.
  - Kanban-owned components and Kanban server modules may keep importing the re-exported types from `src/types/kanban.ts`.
  - Keep `DEFAULT_KANBAN_RUN_PROFILE_ID`, `FULL_ACCESS_KANBAN_RUN_PROFILE_ID`, `BUILTIN_KANBAN_RUN_PROFILES`, and existing function names from `src/server/kanban/runProfiles.ts`.
  - Preserve current Kanban error messages.

- [ ] **Step 4: Verify Slice 5A**

```bash
pnpm exec vitest run src/server/execution/__tests__/runProfiles.test.ts src/server/actions/__tests__/actionRegistry.test.ts src/server/artifacts/__tests__/routes.test.ts src/server/kanban/__tests__/reviewPacketService.test.ts src/server/kanban/__tests__/routes.test.ts src/server/kanban/__tests__/taskService.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts
pnpm run build
git diff --check
git add src/types/execution.ts src/server/execution/runProfiles.ts src/server/execution/__tests__/runProfiles.test.ts src/types/kanban.ts src/types/localActions.ts src/server/actions/actionRegistry.ts src/server/reviewPackets/freshness.ts src/server/actions/__tests__/actionRegistry.test.ts src/server/artifacts/__tests__/routes.test.ts src/server/kanban/runProfiles.ts
git commit -m "refactor(execution): share run profiles"
```

## Slice 5B: Shared Restricted Bridge Adapter

**Files:**
- Create: `src/server/execution/codexBridgeAdapter.ts`
- Create: `src/server/execution/__tests__/codexBridgeAdapter.test.ts`
- Modify: `src/server/kanban/codexBridgeAdapter.ts`

- [ ] **Step 1: Write failing shared adapter tests**
  - Allows configured app-server methods.
  - Rejects non-allowlisted methods with the configured label in the message.
  - Passes notifications through without exposing runtime disposal.

- [ ] **Step 2: Implement shared restricted adapter**
  - Export `RestrictedCodexBridgeAdapter`, `createRestrictedCodexBridgeAdapter`, and method-list type helpers.
  - Accept `{ label: string, allowedMethods: readonly string[] }`.

- [ ] **Step 3: Keep Kanban wrapper**
  - `createKanbanCodexBridgeAdapter()` delegates to the shared factory with label `Kanban Codex bridge`.
  - Existing `KANBAN_CODEX_BRIDGE_ALLOWED_METHODS` and `KanbanCodexBridgeAdapter` remain exported.

- [ ] **Step 4: Verify Slice 5B**

```bash
pnpm exec vitest run src/server/execution/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts
pnpm run build
git diff --check
git add src/server/execution/codexBridgeAdapter.ts src/server/execution/__tests__/codexBridgeAdapter.test.ts src/server/kanban/codexBridgeAdapter.ts
git commit -m "refactor(execution): share bridge adapter"
```

## Slice 5C: Shared Owner-Key Run Queue

**Files:**
- Create: `src/server/execution/runQueue.ts`
- Create: `src/server/execution/__tests__/runQueue.test.ts`
- Modify: `src/server/kanban/taskQueue.ts`
- Modify: `src/server/kanban/__tests__/taskQueue.test.ts`

- [ ] **Step 1: Write failing shared queue tests**
  - Enforces global and repo limits.
  - Enforces owner limits using `ownerKey`.
  - Rejects duplicate queued owners.
  - Promotes eligible items when an active run completes.

- [ ] **Step 2: Implement shared queue**
  - Export `ExecutionRunQueue`, `ExecutionRunQueueItem`, limits, result, and reason types.
  - Use `ownerKey` instead of `taskId`.

- [ ] **Step 3: Keep Kanban wrapper**
  - `KanbanTaskQueueItem` keeps `taskId`.
  - `KanbanTaskQueue` maps `taskId` to owner key `kanban:task:<taskId>`.
  - Existing return shapes, reason strings, and duplicate task error wording remain unchanged.

- [ ] **Step 4: Verify Slice 5C**

```bash
pnpm exec vitest run src/server/execution/__tests__/runQueue.test.ts src/server/kanban/__tests__/taskQueue.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts
pnpm run build
git diff --check
git add src/server/execution/runQueue.ts src/server/execution/__tests__/runQueue.test.ts src/server/kanban/taskQueue.ts src/server/kanban/__tests__/taskQueue.test.ts
git commit -m "refactor(execution): share run queue"
```

## Slice 5D: Shared Audit Log Source Schema

**Files:**
- Create: `src/server/execution/auditLog.ts`
- Create: `src/server/execution/__tests__/auditLog.test.ts`
- Modify: `src/server/kanban/auditLog.ts`
- Modify: `src/server/kanban/__tests__/auditLog.test.ts`

- [ ] **Step 1: Write failing audit tests**
  - New records use schema `codexui.execution.audit.v1`.
  - New records include `source: 'kanban'`.
  - Hash chain continues from an existing v1 record's `eventHash`.
  - Redaction still happens before hashing/persistence.

- [ ] **Step 2: Implement shared audit log**
  - Move canonical JSON, last-line read, hash-chain writing, source, and schema into `src/server/execution/auditLog.ts`.
  - Keep input sections generic but compatible with Kanban event shape.
  - Accept `source: 'kanban' | 'automation' | 'action'`.
  - Treat legacy `codexui.kanban.audit.v1` lines as read-only previous-hash inputs; do not rewrite or normalize old persisted records in place.

- [ ] **Step 3: Keep Kanban wrapper**
  - `KanbanAuditLog` delegates to shared audit log with source `kanban`.
  - `KanbanAuditEventInput`, `KanbanAuditRecord`, and `KanbanAuditSink` remain exported. `KanbanAuditRecord` describes newly appended Kanban-sourced execution audit records with `schema: 'codexui.execution.audit.v1'` and `source: 'kanban'`; historical v1 lines are only consumed for hash continuity.
  - Existing audit file path remains unchanged.

- [ ] **Step 4: Verify Slice 5D**

```bash
pnpm exec vitest run src/server/execution/__tests__/auditLog.test.ts src/server/kanban/__tests__/auditLog.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts
pnpm run build
git diff --check
git add src/server/execution/auditLog.ts src/server/execution/__tests__/auditLog.test.ts src/server/kanban/auditLog.ts src/server/kanban/__tests__/auditLog.test.ts
git commit -m "refactor(execution): share audit log"
```

## Slice 5E: Worktree Owner Metadata

**Files:**
- Create: `src/server/workspaces/worktreeLocks.ts`
- Modify: `src/server/kanban/worktreeManager.ts`
- Modify: `src/server/workspaces/worktreeService.ts`
- Modify: `src/types/worktree.ts`
- Modify: `src/server/kanban/__tests__/worktreeManager.test.ts`
- Modify: `src/server/workspaces/__tests__/worktreeService.test.ts`

- [ ] **Step 1: Write failing worktree owner tests**
  - New lock JSON includes `owner: { source: 'kanban', id: taskId }`.
  - A legacy lock without `owner` is normalized to `owner.source = 'kanban'` and `owner.id = taskId`.
  - Active lock checks use owner metadata and still block a second active Kanban worktree for the same task.
  - Workspace list exposes owner metadata while keeping `taskId`.
  - Workspace cleanup preserves owner metadata and keeps existing dirty-worktree confirmation behavior.

- [ ] **Step 2: Implement shared worktree lock helpers**
  - Export `MANAGED_WORKTREE_LOCK_FILENAME`, owner types, `normalizeManagedWorktreeOwner`, and `resolveManagedWorktreeRoot`.
  - Keep the existing lock file name `codexui-kanban-worktree.json` in this slice to avoid migration churn.

- [ ] **Step 3: Wire Kanban manager and workspace service**
  - New Kanban locks write `owner`.
  - Reads tolerate old locks.
  - Cleanup confirmation and dirty-worktree protections stay unchanged.

- [ ] **Step 4: Verify Slice 5E and Phase 5**

```bash
pnpm exec vitest run src/server/kanban/__tests__/worktreeManager.test.ts src/server/workspaces/__tests__/worktreeService.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/artifacts/__tests__/routes.test.ts
pnpm exec vitest run src/server/execution/__tests__/runProfiles.test.ts src/server/execution/__tests__/codexBridgeAdapter.test.ts src/server/execution/__tests__/runQueue.test.ts src/server/execution/__tests__/auditLog.test.ts
pnpm exec vitest run src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/kanban/__tests__/taskQueue.test.ts src/server/kanban/__tests__/auditLog.test.ts src/server/kanban/__tests__/worktreeManager.test.ts src/server/workspaces/__tests__/worktreeService.test.ts src/server/kanban/__tests__/policy.test.ts src/server/kanban/__tests__/reviewPacketService.test.ts src/server/kanban/__tests__/startupRecovery.test.ts src/server/kanban/__tests__/recoveryService.test.ts src/server/kanban/__tests__/routes.test.ts src/server/kanban/__tests__/taskService.test.ts
pnpm run build
git diff --check
git add src/server/workspaces/worktreeLocks.ts src/server/kanban/worktreeManager.ts src/server/workspaces/worktreeService.ts src/types/worktree.ts src/server/kanban/__tests__/worktreeManager.test.ts src/server/workspaces/__tests__/worktreeService.test.ts
git commit -m "refactor(execution): add worktree owners"
```

The final long `vitest run` command above is the required Phase 5 compatibility gate and intentionally matches the fixed Kanban primitive regression suite.

## Phase 5 Completion Review

- [ ] Run final spec review against the high-level Phase 5 requirements.
- [ ] Run final code-quality review across all Phase 5 commits.
- [ ] Run final verification:

```bash
pnpm exec vitest run src/server/execution/__tests__/runProfiles.test.ts src/server/execution/__tests__/codexBridgeAdapter.test.ts src/server/execution/__tests__/runQueue.test.ts src/server/execution/__tests__/auditLog.test.ts src/server/kanban/__tests__/taskQueue.test.ts src/server/kanban/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/auditLog.test.ts src/server/kanban/__tests__/worktreeManager.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts
pnpm run build
git diff --check
```

## Self-Review

- Phase 5 coverage:
  - Run profiles: Slice 5A.
  - Bridge adapter shape: Slice 5B.
  - Queue owner keys: Slice 5C.
  - Audit source schema: Slice 5D.
  - Worktree owner metadata: Slice 5E.
  - Artifact source extension is intentionally deferred because the high-level plan says to extend `WorkspaceArtifactSource` only when automation artifact providers are added.
- Later-phase guard:
  - No Automations manual run endpoint.
  - No scheduler.
  - No automation artifact provider.
  - No Kanban projection.
- Compatibility guard:
  - Existing Kanban module names and public wrappers remain.
  - Existing Kanban file paths remain unless explicitly noted.
  - Existing dirty-worktree and execution policy safety checks remain.
