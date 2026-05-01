# Automations Phase 0 Contract Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the exact current thread automation contract before moving storage or adding first-class Automations APIs.

**Architecture:** This slice is documentation-only and creates a durable contract note under `docs/superpowers/notes/`. The note is evidence-backed from current source files, local Codex reference snapshots, and the live `$CODEX_HOME/automations` store. It intentionally avoids production code changes so the next slice can refactor with stable compatibility requirements.

**Tech Stack:** Markdown docs, Git, ripgrep, shell inspection, CodexUI TypeScript/Vue/Express source references.

---

## File Structure

- Create: `docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md`
  - Owns the current-contract map, live automation-store inventory, Desktop/runtime parity note, and migration decision.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Add a one-line link from Phase 0 to the completed contract-discovery note after the note exists.
- No production source files change in this slice.
- No UI files change in this slice.
- No `tests.md` change is required because this slice does not implement or alter user-visible runtime behavior.

## Task 1: Create The Contract Discovery Note

**Files:**
- Create: `docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md`

- [ ] **Step 1: Reconfirm current branch and clean worktree**

Run:

```bash
git status --short --branch
```

Expected:

```text
## feat/automations
```

- [ ] **Step 2: Gather current source-contract evidence**

Run:

```bash
rg -n "ThreadAutomation|thread-automation|thread-automations|automation.toml|heartbeat|Automation" src/types/codex.ts src/api/codexGateway.ts src/components/sidebar/SidebarThreadTree.vue src/server/codexAppServerBridge.ts tests.md
```

Expected:

```text
src/types/codex.ts:79:export type UiThreadAutomationStatus = 'ACTIVE' | 'PAUSED'
src/api/codexGateway.ts:1041:export async function getThreadAutomationMap(): Promise<Record<string, UiThreadAutomation>> {
src/components/sidebar/SidebarThreadTree.vue:544:        <button class="thread-menu-item" type="button" @click="openAutomationDialog(openThreadMenuThread.id)">
src/server/codexAppServerBridge.ts:2553:function getCodexAutomationsDir(): string {
tests.md:22:### Feature: Thread heartbeat automations
```

- [ ] **Step 3: Gather live automation-store inventory**

Run:

```bash
find "${CODEX_HOME:-$HOME/.codex}/automations" -maxdepth 2 -type f -name 'automation.toml' -printf '%p\n' 2>/dev/null | sort
```

Expected for the current host if there are no records:

```text
```

If records exist later, write only redacted structural facts in the note: directory count, file paths, keys present, status values, and whether `target_thread_id` exists. Do not paste prompts or secrets.

- [ ] **Step 4: Gather local Codex parity evidence**

Run:

```bash
rg -n "automation|Automations|heartbeat|TOML|toml" ${CODEX_HOME:-$HOME/.codex}/docs/codex ${CODEX_HOME:-$HOME/.codex}/reports/docs-seeker/codex-official-docs -S
```

Expected:

```text
${CODEX_HOME:-$HOME/.codex}/docs/codex/upstream/openai-codex-agents_md.md:...
${CODEX_HOME:-$HOME/.codex}/docs/codex/config-reference-expanded.md:...
${CODEX_HOME:-$HOME/.codex}/docs/codex/runtime/codex-help.txt:...
```

The expected result has config/TOML hits but no documented automation schema. Record that distinction in the note.

- [ ] **Step 5: Add the note**

Create `docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md` with this exact structure:

```markdown
# Automations Phase 0 Contract Discovery

Date: 2026-04-30
Branch: `feat/automations`
Scope: current thread heartbeat automation contract before storage extraction or first-class Automations API work.

## Summary

- Current CodexUI thread automations are a narrow heartbeat feature, not a first-class automations subsystem.
- The compatibility boundary is `$CODEX_HOME/automations/<automation-id>/automation.toml`.
- Legacy API and UI status casing is `ACTIVE` and `PAUSED`.
- The local Codex reference snapshots do not document an automation TOML schema.
- Migration decision: use sidecar-first CodexUI metadata, defaulting to `codexui.json`, until Desktop/runtime parity proves extra TOML fields are safe.

## Current Source Contract

### Types

- `src/types/codex.ts` defines `UiThreadAutomationStatus = 'ACTIVE' | 'PAUSED'`.
- `UiThreadAutomation.kind` currently accepts `heartbeat` and `cron`.
- `UiThreadAutomation` exposes `id`, `kind`, `name`, `prompt`, `rrule`, `status`, `targetThreadId`, `createdAtMs`, `updatedAtMs`, and `nextRunAtMs`.

### Client Gateway

- `src/api/codexGateway.ts` parses thread automation payloads with `asAutomation`.
- `asAutomation` accepts only `heartbeat` and `cron` kinds.
- The client API surface is:
  - `getThreadAutomationMap()`
  - `getThreadAutomation(threadId)`
  - `upsertThreadAutomation(input)`
  - `deleteThreadAutomation(threadId)`
- Gateway calls use `/codex-api/thread-automations` and `/codex-api/thread-automation`.

### Sidebar UI

- `src/components/sidebar/SidebarThreadTree.vue` owns the current create/edit/delete dialog.
- The thread menu label switches between `Add automation...` and `Edit automation...`.
- The dialog writes `name`, `prompt`, `rrule`, and uppercase status.
- Thread deletion attempts to remove the attached heartbeat automation.

### Server Bridge

- `src/server/codexAppServerBridge.ts` stores automations under `getCodexHomeDir()/automations`.
- `parseAutomationToml` reads a narrow top-level key/value subset.
- Required parsed fields are `id`, `name`, `prompt`, and `rrule`.
- Accepted `kind` values are `heartbeat` and `cron`.
- Accepted `status` values are `ACTIVE` and `PAUSED`.
- `serializeAutomationToml` writes `version`, `id`, `kind`, `name`, `prompt`, `status`, `rrule`, `target_thread_id`, `created_at`, and `updated_at`.
- `writeThreadHeartbeatAutomation` creates `memory.md` if missing.
- `deleteThreadHeartbeatAutomation` removes the entire automation directory.

### Manual Test Coverage

- `tests.md` contains a manual test section named `Thread heartbeat automations`.
- The test expects creation under the Codex automations store and attachment by `target_thread_id`.

## Live Store Inventory

Command:

```bash
find "${CODEX_HOME:-$HOME/.codex}/automations" -maxdepth 2 -type f -name 'automation.toml' -printf '%p\n' 2>/dev/null | sort
```

Current result: no `automation.toml` files were found on this host.

Implication: the first extraction should rely on synthetic fixtures for compatibility tests, not on host-local records.

## Desktop And Runtime Parity Evidence

Checked local reference root: `${CODEX_HOME:-$HOME/.codex}/docs/codex/README.md`.

Checked snapshots:

- `${CODEX_HOME:-$HOME/.codex}/docs/codex/runtime/`
- `${CODEX_HOME:-$HOME/.codex}/docs/codex/upstream/`
- `${CODEX_HOME:-$HOME/.codex}/reports/docs-seeker/codex-official-docs/`

Result: current local snapshots contain Codex config TOML references, but no documented automation TOML schema or Desktop Automations storage contract.

Implication: do not add CodexUI metadata to `automation.toml` based on inferred Desktop behavior.

## Migration Decision

Use sidecar-first metadata:

- Native runtime/Desktop-compatible record: `automation.toml`.
- CodexUI metadata record: `codexui.json`.
- Legacy thread endpoints continue to expose uppercase `ACTIVE` and `PAUSED`.
- First-class Automations types can use internal lowercase status only through an explicit adapter.
- Imported heartbeat records keep nullable `projectRoot`, `cwd`, `runMode`, `runProfileId`, `model`, and `reasoningEffort` until explicitly configured.

## Phase 2 Guardrails

- Extract parser/serializer/list/read/write/delete behavior without changing endpoint response shape.
- Add a `legacyAdapter.ts` boundary for case and field translation.
- Preserve or avoid touching unknown TOML fields during sidecar-only metadata operations.
- Do not introduce scheduler or runner behavior in the store-extraction slice.
- Add synthetic fixtures for `ACTIVE`, `PAUSED`, invalid records, and unknown TOML fields.
```

- [ ] **Step 6: Verify the note has no unfinished markers**

Run:

```bash
rg -n "TB[D]|TO[D]O|implement[[:space:]]+later|PLACEHOLDER" docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md
```

Expected: exit code `1` with no matches.

## Task 2: Link Phase 0 From The High-Level Plan

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`

- [ ] **Step 1: Add completion link under Phase 0**

In `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`, add this line after the Phase 0 expected-outcome bullets:

```markdown
Phase 0 contract discovery artifact: [`../notes/2026-04-30-automations-phase-0-contract-discovery.md`](../notes/2026-04-30-automations-phase-0-contract-discovery.md).
```

- [ ] **Step 2: Verify the link text exists**

Run:

```bash
rg -n "Phase 0 contract discovery artifact" docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md
```

Expected:

```text
docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md:<line>:Phase 0 contract discovery artifact: [`../notes/2026-04-30-automations-phase-0-contract-discovery.md`](../notes/2026-04-30-automations-phase-0-contract-discovery.md).
```

## Task 3: Verify And Commit Phase 0

**Files:**
- Verify: `docs/superpowers/plans/2026-04-30-automations-phase-0-contract-discovery.md`
- Verify: `docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md`
- Verify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`

- [ ] **Step 1: Run markdown whitespace verification**

Run:

```bash
git diff --check
```

Expected: exit code `0`.

- [ ] **Step 2: Review changed files**

Run:

```bash
git diff --stat
git diff -- docs/superpowers/plans/2026-04-30-automations-phase-0-contract-discovery.md docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md
```

Expected: only the plan, note, and high-level link are changed.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-04-30-automations-phase-0-contract-discovery.md docs/superpowers/notes/2026-04-30-automations-phase-0-contract-discovery.md docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md
git commit -m "docs(automations): capture phase 0 contract discovery"
```

Expected: a single docs commit on `feat/automations`.

## Self-Review

- Spec coverage: Phase 0 requires a code map, live store inventory, Desktop/runtime parity note, and sidecar migration decision. Tasks 1 and 2 cover those requirements.
- Unfinished-marker scan: the new note should not contain unresolved work markers or deferred-fill wording.
- Type consistency: the plan consistently uses `UiThreadAutomation`, `UiThreadAutomationStatus`, `ACTIVE`, `PAUSED`, `automation.toml`, and `codexui.json`.
