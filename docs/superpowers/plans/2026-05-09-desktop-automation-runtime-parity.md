# Desktop Automation Runtime Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align CodexUI automations with Codex Desktop so both apps share Desktop TOML definitions and Desktop SQLite runtime state without divergent scheduler/run stores.

**Architecture:** Keep `$CODEX_HOME/automations/<id>/automation.toml` as the canonical definition store. Replace CodexUI-only `scheduler.json`, `scheduler-lock*.json`, `runs/*`, and `.active-runs.json` runtime state with the same SQLite tables Desktop uses under `$CODEX_HOME/sqlite/codex-dev.db` or `$CODEX_HOME/sqlite/codex.db`. CodexUI scheduling remains opt-in fallback work: Desktop owns scheduling when the Desktop scheduler process is detected.

**Tech Stack:** TypeScript, Node server, Express, `smol-toml`, `better-sqlite3`, Vitest.

---

## Current Implementation Inventory

The current branch is `feature/automation-standalone-desktop-parity` in `/home/drj/projects/codexUI-automation-standalone-desktop-parity`.

Definition parity is close:

- `src/server/automations/nativeStore.ts` reads and writes Desktop-style `automation.toml`.
- `memory.md` is created under the Desktop-compatible automation directory.
- `src/server/automations/service.ts` treats TOML as the source for user-visible definitions.

Runtime parity is not close enough yet:

- `src/server/automations/schedulerStore.ts` stores scheduler state in `scheduler.json`; Desktop stores `next_run_at` and `last_run_at` in SQLite table `automations`.
- `src/server/automations/runStore.ts` stores runs in `runs/<id>/run.json`; Desktop stores run/inbox state in SQLite table `automation_runs`.
- `src/server/automations/schedulerLease.ts` writes file leases; Desktop does not use these files.
- `src/server/automations/scheduler.ts` ticks every 60 seconds by default; Desktop ticks every 30 seconds and starts at most 3 automations per tick.
- `src/server/automations/scheduleCalculator.ts` implements a partial RRULE evaluator but does not implement Desktop's stable jitter salt behavior.
- `src/server/automations/schedulerConfig.ts` defaults to Desktop ownership and has Linux-only process detection.
- `src/server/automations/runner.ts` writes CodexUI-specific run records instead of Desktop-compatible `automation_runs` rows.

Desktop evidence:

- Desktop writes canonical definitions to `$CODEX_HOME/automations/<id>/automation.toml`.
- Desktop stores runtime state in `$CODEX_HOME/sqlite/codex-dev.db` or `$CODEX_HOME/sqlite/codex.db`.
- Desktop table `automations` includes `id`, `name`, `prompt`, `status`, `next_run_at`, `last_run_at`, `cwds`, `rrule`, `model`, `reasoning_effort`, `created_at`, `updated_at`.
- Desktop table `automation_runs` includes `thread_id`, `automation_id`, `status`, `read_at`, `thread_title`, `source_cwd`, `inbox_title`, `inbox_summary`, `created_at`, `updated_at`, `archived_user_message`, `archived_assistant_message`, `archived_reason`.
- Desktop scheduler runs in the Electron main process, not in app-server generated APIs.

## Target File Structure

- Create `src/server/automations/desktopProcess.ts`: cross-platform Desktop process detection.
- Create `src/server/automations/desktopProcess.test.ts`: process detection unit tests using injected process snapshots.
- Create `src/server/automations/desktopSqlite.ts`: SQLite path resolution, schema creation, timestamp conversion, safe transaction helper.
- Create `src/server/automations/desktopRuntimeStore.ts`: Desktop-compatible runtime state adapter for `automations` and `automation_runs`.
- Create `src/server/automations/runtimeStore.ts`: narrow interface consumed by service/scheduler/runner.
- Modify `src/server/automations/schedulerConfig.ts`: use `desktopProcess.ts`, cache detection, support Linux/macOS/Windows.
- Modify `src/server/automations/scheduler.ts`: switch default tick to 30 seconds and use runtime store due-state instead of `scheduler.json`.
- Modify `src/server/automations/service.ts`: read `nextRunAtIso`, `lastRunAtIso`, run history, and triage from SQLite.
- Modify `src/server/automations/runner.ts`: create/update Desktop `automation_runs` rows and stop writing CodexUI run JSON for new runs.
- Modify `src/server/automations/scheduleCalculator.ts`: add Desktop-compatible jitter and heartbeat interval cooldown.
- Modify `src/types/automations.ts`: keep UI types stable, but mark fields derived from Desktop SQLite where needed.
- Modify `src/server/automations/__tests__/*.test.ts`: update tests from file-state expectations to SQLite-state expectations.
- Modify `package.json` and lockfile: add `better-sqlite3` and matching TypeScript types if needed.
- Modify `tests.md`: add manual verification steps for Desktop interoperability, scheduler ownership, and cross-platform process detection behavior.
- Add `llm-wiki/raw/features/desktop-automation-runtime-parity.md` and update `llm-wiki/wiki/concepts/thread-heartbeat-automations.md` or add a dedicated concept page.

---

### Task 1: Cross-Platform Desktop Process Detection

**Files:**
- Create: `src/server/automations/desktopProcess.ts`
- Create: `src/server/automations/desktopProcess.test.ts`
- Modify: `src/server/automations/schedulerConfig.ts`
- Modify: `src/server/automations/__tests__/schedulerConfig.test.ts`

- [ ] **Step 1: Add failing tests for Linux, macOS, Windows, and CLI false positives**

Create `src/server/automations/desktopProcess.test.ts` with injected snapshots so no test depends on the host OS:

```ts
import { describe, expect, it } from 'vitest'
import { detectCodexDesktopFromSnapshot, type ProcessSnapshotEntry } from './desktopProcess'

function p(input: Partial<ProcessSnapshotEntry> & Pick<ProcessSnapshotEntry, 'pid'>): ProcessSnapshotEntry {
  return {
    pid: input.pid,
    ppid: input.ppid ?? null,
    name: input.name ?? '',
    commandLine: input.commandLine ?? '',
    executablePath: input.executablePath ?? '',
    environment: input.environment ?? {},
  }
}

describe('detectCodexDesktopFromSnapshot', () => {
  it('detects Linux Codex Desktop Electron main process', () => {
    const result = detectCodexDesktopFromSnapshot([
      p({ pid: 10, name: 'electron', executablePath: '/opt/codex-desktop/electron', commandLine: '/opt/codex-desktop/electron --app-id=codex-desktop' }),
    ])

    expect(result.active).toBe(true)
    expect(result.detectedBy).toContain('linux-executable')
  })

  it('detects macOS Codex.app main process', () => {
    const result = detectCodexDesktopFromSnapshot([
      p({ pid: 20, name: 'Codex', executablePath: '/Applications/Codex.app/Contents/MacOS/Codex', commandLine: '/Applications/Codex.app/Contents/MacOS/Codex' }),
    ])

    expect(result.active).toBe(true)
    expect(result.detectedBy).toContain('macos-app')
  })

  it('detects Windows Codex.exe installed app process', () => {
    const result = detectCodexDesktopFromSnapshot([
      p({ pid: 30, name: 'Codex.exe', executablePath: 'C:\\Users\\drj\\AppData\\Local\\Programs\\Codex\\Codex.exe', commandLine: '"C:\\Users\\drj\\AppData\\Local\\Programs\\Codex\\Codex.exe"' }),
    ])

    expect(result.active).toBe(true)
    expect(result.detectedBy).toContain('windows-executable')
  })

  it('detects a Desktop-owned app-server by parent chain', () => {
    const result = detectCodexDesktopFromSnapshot([
      p({ pid: 100, name: 'Codex', executablePath: '/Applications/Codex.app/Contents/MacOS/Codex' }),
      p({ pid: 101, ppid: 100, name: 'node', commandLine: 'node /usr/local/bin/codex app-server --analytics-default-enabled' }),
      p({ pid: 102, ppid: 101, name: 'codex', commandLine: 'codex app-server --analytics-default-enabled' }),
    ])

    expect(result.active).toBe(true)
    expect(result.candidates.some((candidate) => candidate.kind === 'desktop-owned-app-server')).toBe(true)
  })

  it('does not treat CodexUI or CLI app-server processes as Desktop', () => {
    const result = detectCodexDesktopFromSnapshot([
      p({ pid: 200, name: 'node', commandLine: 'node /home/drj/.local/share/npm/bin/codex app-server -c approval_policy="never"' }),
      p({ pid: 201, ppid: 200, name: 'codex', commandLine: '/home/drj/.local/share/npm/lib/node_modules/@openai/codex/vendor/codex app-server -c sandbox_mode="danger-full-access"' }),
    ])

    expect(result.active).toBe(false)
  })
})
```

Run:

```bash
pnpm vitest run src/server/automations/desktopProcess.test.ts
```

Expected: FAIL because `desktopProcess.ts` does not exist.

- [ ] **Step 2: Implement process snapshot scoring**

Create `src/server/automations/desktopProcess.ts` with a snapshot classifier that scores:

- `desktop-env`: env `CODEX_ELECTRON_RESOURCES_PATH` under a Codex resources directory.
- `linux-executable`: `/opt/codex-desktop/electron` or equivalent command line.
- `macos-app`: `*/Codex.app/Contents/MacOS/Codex`.
- `windows-executable`: `Codex.exe` under a Codex app install directory.
- `desktop-app-asar`: command line points to a Codex `resources/app.asar`.
- `desktop-app-server-env`: app-server env `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`.
- `desktop-app-server-parent`: app-server parent chain reaches a Desktop main candidate.

The classifier must not treat generic `codex app-server` CLI processes as Desktop unless the Desktop env marker or parent chain is present.

Run:

```bash
pnpm vitest run src/server/automations/desktopProcess.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add OS snapshot providers and cached public detector**

Extend `desktopProcess.ts` with:

- Linux: `/proc/<pid>/cmdline`, `/proc/<pid>/status`, `/proc/<pid>/exe`, `/proc/<pid>/environ`.
- macOS: `ps -axo pid=,ppid=,comm=,args=`.
- Windows: PowerShell/CIM:

```powershell
Get-CimInstance Win32_Process |
  Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |
  ConvertTo-Json -Compress
```

Public API:

```ts
export function canDetectCodexDesktopProcess(platform = process.platform): boolean
export function detectCodexDesktopProcess(): boolean
export function detectCodexDesktopProcessDetails(nowMs = Date.now()): CodexDesktopDetection
```

Cache process detection for 10 seconds to avoid expensive Windows/macOS process scans on every scheduler tick.

Run:

```bash
pnpm vitest run src/server/automations/desktopProcess.test.ts src/server/automations/__tests__/schedulerConfig.test.ts
```

Expected: PASS.

- [ ] **Step 4: Wire scheduler config to the new detector**

Modify `src/server/automations/schedulerConfig.ts`:

```ts
import {
  canDetectCodexDesktopProcess,
  detectCodexDesktopProcess,
} from './desktopProcess'
```

Remove the local `/proc` scanner from `schedulerConfig.ts`.

Run:

```bash
pnpm vitest run src/server/automations/__tests__/schedulerConfig.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/automations/desktopProcess.ts src/server/automations/desktopProcess.test.ts src/server/automations/schedulerConfig.ts src/server/automations/__tests__/schedulerConfig.test.ts
git commit -m "feat: detect codex desktop scheduler cross platform"
```

---

### Task 2: Desktop SQLite Access Layer

**Files:**
- Create: `src/server/automations/desktopSqlite.ts`
- Create: `src/server/automations/__tests__/desktopSqlite.test.ts`
- Modify: `package.json`
- Modify: lockfile

- [ ] **Step 1: Add failing SQLite path/schema tests**

Create `src/server/automations/__tests__/desktopSqlite.test.ts` to prove:

- `codex-dev.db` is used for dev flavor.
- `codex.db` is used for prod flavor.
- Desktop-compatible tables are created if missing.
- `next_run_at`, `last_run_at`, and archive columns exist.

Run:

```bash
pnpm vitest run src/server/automations/__tests__/desktopSqlite.test.ts
```

Expected: FAIL because the module and dependency are missing.

- [ ] **Step 2: Add dependency**

Run:

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

Expected: `package.json` and lockfile update.

- [ ] **Step 3: Implement SQLite helper**

Create `src/server/automations/desktopSqlite.ts` with:

- `resolveDesktopAutomationSqlitePath(options)`.
- `openDesktopAutomationSqlite(options)`.
- `closeDesktopAutomationSqlite()`.
- `ensureDesktopAutomationSchema(db)`.
- `msToIso(value)`.
- `isoToMs(value)`.

The schema must match Desktop's current tables exactly:

```sql
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  next_run_at INTEGER,
  last_run_at INTEGER,
  cwds TEXT NOT NULL DEFAULT '[]',
  rrule TEXT NOT NULL DEFAULT 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0',
  model TEXT,
  reasoning_effort TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  thread_id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  read_at INTEGER,
  thread_title TEXT,
  source_cwd TEXT,
  inbox_title TEXT,
  inbox_summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_user_message TEXT,
  archived_assistant_message TEXT,
  archived_reason TEXT
);
```

Run:

```bash
pnpm vitest run src/server/automations/__tests__/desktopSqlite.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/server/automations/desktopSqlite.ts src/server/automations/__tests__/desktopSqlite.test.ts
git commit -m "feat: add desktop automation sqlite access"
```

---

### Task 3: Runtime Store Interface Backed By Desktop SQLite

**Files:**
- Create: `src/server/automations/runtimeStore.ts`
- Create: `src/server/automations/desktopRuntimeStore.ts`
- Create: `src/server/automations/__tests__/desktopRuntimeStore.test.ts`

- [ ] **Step 1: Add failing runtime store tests**

Create tests proving:

- `upsertAutomationState()` writes `automations.next_run_at`, `last_run_at`, `cwds`, `rrule`, `model`, and `reasoning_effort`.
- `listDueAutomationStates(nowIso, limit)` returns active due rows sorted by `next_run_at`.
- `upsertRun()` writes `automation_runs`.
- `markRunPendingReview()`, `markRunAccepted()`, and `markRunArchived()` update Desktop status fields.

Run:

```bash
pnpm vitest run src/server/automations/__tests__/desktopRuntimeStore.test.ts
```

Expected: FAIL because modules are missing.

- [ ] **Step 2: Create the runtime interface**

Create `src/server/automations/runtimeStore.ts` with:

```ts
export type DesktopAutomationRuntimeStatus = 'ACTIVE' | 'PAUSED' | 'DELETED'
export type DesktopAutomationRunStatus = 'IN_PROGRESS' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ARCHIVED'
```

Define `DesktopAutomationStateRow`, `DesktopAutomationRunRow`, and `AutomationRuntimeStore` around Desktop's two tables. The interface should not include CodexUI-only fields.

- [ ] **Step 3: Implement Desktop SQLite runtime store**

Create `src/server/automations/desktopRuntimeStore.ts` and map directly to Desktop's table names and column names. Store `cwds` as JSON in `automations.cwds`. Convert timestamps between ISO strings and integer milliseconds with helpers from `desktopSqlite.ts`.

Run:

```bash
pnpm vitest run src/server/automations/__tests__/desktopRuntimeStore.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/automations/runtimeStore.ts src/server/automations/desktopRuntimeStore.ts src/server/automations/__tests__/desktopRuntimeStore.test.ts
git commit -m "feat: store automation runtime state in desktop sqlite"
```

---

### Task 4: Replace `scheduler.json` With SQLite Scheduler State

**Files:**
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/scheduler.ts`
- Modify: `src/server/automations/index.ts`
- Deprecate but do not delete in this task: `src/server/automations/schedulerStore.ts`
- Modify: `src/server/automations/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add failing scheduler tests proving no `scheduler.json` is written for new state**

Update scheduler tests that currently assert `scheduler.json` writes so they assert SQLite rows instead:

```ts
const runtimeState = await service.readRuntimeStateForTest('daily-check')
expect(runtimeState?.nextRunAtIso).toBe('2026-05-01T09:00:00.000Z')
await expect(readFile(join(automationDir, 'scheduler.json'), 'utf8')).rejects.toThrow()
```

Run:

```bash
pnpm vitest run src/server/automations/__tests__/scheduler.test.ts
```

Expected: FAIL until service/scheduler read SQLite.

- [ ] **Step 2: Inject the runtime store into `AutomationsService`**

Add to `AutomationsServiceOptions`:

```ts
runtimeStore?: AutomationRuntimeStore
```

In the constructor:

```ts
this.runtimeStore = options.runtimeStore ?? createDesktopAutomationRuntimeStore({
  codexHomeDir: options.codexHomeDir,
})
```

- [ ] **Step 3: Replace `refreshSchedulerState` with SQLite upsert**

When definitions are created, edited, paused, resumed, or listed, upsert a Desktop `automations` row. Do not write `nextRunAt` or `lastRunAt` to TOML.

- [ ] **Step 4: Map list definitions from SQLite state**

In `mapDefinition`, replace file-derived scheduler/run state with SQLite-derived `nextRunAtIso` and `lastRunAtIso`.

- [ ] **Step 5: Update scheduler due selection**

Change scheduler due candidate discovery to use:

```ts
const dueStates = await this.service.listDueRuntimeStates(nowIso, this.maxRunsPerTick)
```

Then resolve each TOML entry fresh by id before starting a run.

- [ ] **Step 6: Set Desktop tick default**

Change scheduler default from `60_000` to `30_000`; keep `DEFAULT_MAX_RUNS_PER_TICK = 3`.

- [ ] **Step 7: Run tests**

```bash
pnpm vitest run src/server/automations/__tests__/scheduler.test.ts src/server/automations/__tests__/desktopRuntimeStore.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/automations/service.ts src/server/automations/scheduler.ts src/server/automations/index.ts src/server/automations/__tests__/scheduler.test.ts
git commit -m "feat: use desktop sqlite for scheduler state"
```

---

### Task 5: Replace CodexUI Run JSON With Desktop `automation_runs`

**Files:**
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/service.ts`
- Deprecate but do not delete in this task: `src/server/automations/runStore.ts`
- Modify: `src/server/automations/__tests__/scheduler.test.ts`
- Modify: `src/server/automations/__tests__/runStore.test.ts`

- [ ] **Step 1: Add failing tests for Desktop run rows**

Update run lifecycle tests to assert `automation_runs` rows with Desktop statuses:

```ts
expect(rows[0]).toMatchObject({
  automationId: 'daily-check',
  status: 'IN_PROGRESS',
  sourceCwd: '/tmp/project',
})
```

For completion:

```ts
expect(rows[0]).toMatchObject({
  status: 'PENDING_REVIEW',
  inboxTitle: 'Needs attention',
})
```

- [ ] **Step 2: Convert runner run creation**

When a thread has not been created yet, create a temporary pending thread id:

```ts
const pendingThreadId = `pending:${run.id}`
```

Insert an `IN_PROGRESS` row, then replace the pending thread id after `thread/start` or `thread/resume` returns the real thread id.

- [ ] **Step 3: Convert completion handling**

On completed result:

- `PENDING_REVIEW` when there are findings.
- `ACCEPTED` when there are no findings and the run is auto-read.
- `PENDING_REVIEW` for failure summaries that need user attention.

- [ ] **Step 4: Convert route triage**

`markRunRead`, `archiveRun`, and `unarchiveRun` should update `automation_runs.read_at`, `status`, and archive columns instead of `runs/*/run.json`.

- [ ] **Step 5: Preserve UI compatibility**

Map `DesktopAutomationRunRow` to the existing `AutomationRun` response shape. Fields that Desktop does not persist should be null or empty, not stored in a side table.

- [ ] **Step 6: Run tests**

```bash
pnpm vitest run src/server/automations/__tests__/scheduler.test.ts src/server/automations/__tests__/desktopRuntimeStore.test.ts src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/automations/runner.ts src/server/automations/service.ts src/server/automations/__tests__/scheduler.test.ts src/server/automations/__tests__/runStore.test.ts src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
git commit -m "feat: use desktop sqlite for automation runs"
```

---

### Task 6: Desktop-Compatible Scheduling Heuristics

**Files:**
- Modify: `src/server/automations/scheduleCalculator.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/__tests__/scheduleCalculator.test.ts`
- Modify: `src/server/automations/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add failing tests for Desktop jitter**

Add tests proving:

- cron hourly/daily/weekly schedules get stable jitter under 120 seconds;
- heartbeat interval schedules do not get jitter;
- jitter is stable for the same automation id, due time, and salt.

- [ ] **Step 2: Implement `.run-jitter-salt` handling**

Read or create:

```txt
$CODEX_HOME/automations/.run-jitter-salt
```

Use SHA-256:

```ts
const offsetSeconds = createHash('sha256')
  .update(`${salt}:${automationId}:${Date.parse(nextRunAtIso)}`)
  .digest()
  .readUInt32BE(0) % 120
```

- [ ] **Step 3: Add heartbeat interval cooldown calculation**

For heartbeat interval schedules:

```ts
nextRunAt = max(lastRunAt, targetThread.updatedAt) + intervalMs
```

The runner already reads target thread state for eligibility. Extend that path to return `updatedAt` and use it before marking a heartbeat due.

- [ ] **Step 4: Add Desktop renderer-state cache window**

Desktop treats renderer eligibility state as fresh for about 2 minutes. Add:

```ts
const HEARTBEAT_RENDERER_STATE_TTL_MS = 2 * 60_000
```

Ignore older renderer eligibility records and defer heartbeat runs with:

```txt
Heartbeat renderer state has not loaded for target thread
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run src/server/automations/__tests__/scheduleCalculator.test.ts src/server/automations/__tests__/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/automations/scheduleCalculator.ts src/server/automations/service.ts src/server/automations/runner.ts src/server/automations/__tests__/scheduleCalculator.test.ts src/server/automations/__tests__/scheduler.test.ts
git commit -m "feat: match desktop automation scheduling heuristics"
```

---

### Task 7: Scheduler Ownership UX and API State

**Files:**
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `src/composables/useAutomations.ts`
- Modify: `src/composables/useAutomations.test.ts`

- [ ] **Step 1: Extend state shape**

Add to `AutomationsState`:

```ts
schedulerOwnership: {
  mode: 'desktop' | 'codexui' | 'disabled'
  desktopDetected: boolean
  detectionSupported: boolean
  reason: string
}
```

- [ ] **Step 2: Surface ownership in `/state`**

Use `detectCodexDesktopProcessDetails()` and scheduler preference to return one of:

- `desktop`: Desktop detected or env explicitly selects Desktop ownership.
- `codexui`: fallback scheduler enabled and Desktop not detected.
- `disabled`: unsupported detection or explicit disabled.

- [ ] **Step 3: UI copy**

Show a restrained status line:

```txt
Scheduling is handled by Codex Desktop.
```

or:

```txt
Scheduling fallback is handled by CodexUI.
```

Do not add a second policy UI layer.

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/composables/useAutomations.test.ts src/api/automationsGateway.test.ts
pnpm run build:frontend
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/automations.ts src/server/automations/service.ts src/components/automations/AutomationsPage.vue src/composables/useAutomations.ts src/composables/useAutomations.test.ts
git commit -m "feat: show automation scheduler ownership"
```

---

### Task 8: Compatibility Migration and Cleanup

**Files:**
- Create: `src/server/automations/legacyRuntimeMigration.ts`
- Create: `src/server/automations/__tests__/legacyRuntimeMigration.test.ts`
- Modify: `src/server/automations/service.ts`
- Keep for read-only migration only: `src/server/automations/schedulerStore.ts`, `src/server/automations/runStore.ts`

- [ ] **Step 1: Add migration tests**

Test that existing CodexUI files are imported once into SQLite:

- `scheduler.json` next due state migrates to `automations.next_run_at`.
- `runs/<id>/run.json` migrates to `automation_runs`.
- A marker prevents repeated migration.

- [ ] **Step 2: Implement idempotent migration**

Write a marker file:

```txt
$CODEX_HOME/automations/.codexui-runtime-migrated-to-desktop-sqlite
```

Only migrate if the marker is absent.

- [ ] **Step 3: Disable new writes to legacy files**

After Tasks 4 and 5, `schedulerStore.ts` and `runStore.ts` should only be used by `legacyRuntimeMigration.ts` and tests. Add comments at module top:

```ts
// Legacy CodexUI runtime store. Do not use for new runtime writes; Desktop SQLite is canonical.
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/server/automations/__tests__/legacyRuntimeMigration.test.ts src/server/automations/__tests__/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/automations/legacyRuntimeMigration.ts src/server/automations/__tests__/legacyRuntimeMigration.test.ts src/server/automations/service.ts src/server/automations/schedulerStore.ts src/server/automations/runStore.ts
git commit -m "feat: migrate legacy automation runtime files to desktop sqlite"
```

---

### Task 9: Documentation and Verification

**Files:**
- Modify: `tests.md`
- Create: `llm-wiki/raw/features/desktop-automation-runtime-parity.md`
- Create or modify: `llm-wiki/wiki/concepts/desktop-automation-runtime-parity.md`
- Modify: `llm-wiki/wiki/index.md`
- Modify: `llm-wiki/wiki/log.md`

- [ ] **Step 1: Update `tests.md`**

Add manual verification with:

- Desktop running: create/edit automation in CodexUI, wait Desktop tick, verify SQLite `automations` row.
- Desktop running: CodexUI scheduler ownership shows Desktop.
- Desktop stopped with `CODEXUI_AUTOMATIONS_SCHEDULER=auto`: CodexUI scheduler ownership shows CodexUI fallback.
- Desktop-created automation: CodexUI shows same definition and state.
- Run history: Desktop `automation_runs` rows appear in CodexUI.
- Dark theme and light theme page checks.

- [ ] **Step 2: Add wiki source**

Record source facts:

```md
# Desktop Automation Runtime Parity Source

- Desktop canonical definitions live under `$CODEX_HOME/automations/<automation_id>/automation.toml`.
- Desktop runtime state lives under `$CODEX_HOME/sqlite/codex-dev.db` or `$CODEX_HOME/sqlite/codex.db`.
- Desktop table `automations` stores `next_run_at` and `last_run_at`.
- Desktop table `automation_runs` stores run/inbox/archive state.
- Desktop scheduler is owned by the Electron main process.
```

- [ ] **Step 3: Add concept page and index entry**

Create a concise concept page linking the raw source.

- [ ] **Step 4: Run final verification**

```bash
pnpm vitest run src/server/automations/__tests__/desktopSqlite.test.ts src/server/automations/__tests__/desktopRuntimeStore.test.ts src/server/automations/__tests__/schedulerConfig.test.ts src/server/automations/__tests__/scheduleCalculator.test.ts src/server/automations/__tests__/scheduler.test.ts src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
pnpm run build:frontend
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add tests.md llm-wiki/raw/features/desktop-automation-runtime-parity.md llm-wiki/wiki/concepts/desktop-automation-runtime-parity.md llm-wiki/wiki/index.md llm-wiki/wiki/log.md
git commit -m "docs: document desktop automation runtime parity"
```

---

## Process Detection Plan By Platform

### Linux

Use `/proc` because it exposes command line, parent PID, executable path, and environment without extra dependencies.

Primary positive signals:

- executable or command line contains `/opt/codex-desktop/electron`;
- command line contains `--app-id=codex-desktop`;
- environment contains `CODEX_ELECTRON_RESOURCES_PATH=/opt/codex-desktop/resources`;
- app-server child has `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`;
- app-server parent chain reaches the Electron Desktop process.

False positive exclusions:

- `node ... codex app-server -c approval_policy=...` launched by CodexUI;
- npm/global CLI paths containing `@openai/codex` without Desktop parent chain;
- `codex-update-manager` alone.

### macOS

Use `ps -axo pid=,ppid=,comm=,args=` for a no-dependency snapshot.

Primary positive signals:

- executable or command line contains `/Codex.app/Contents/MacOS/Codex`;
- process name is `Codex` and command line points inside `Codex.app`;
- command line contains `Codex.app/Contents/Resources/app.asar`;
- app-server child parent chain reaches the Codex.app process.

False positive exclusions:

- CLI `codex app-server` without parent chain to `Codex.app`;
- helper processes whose parent chain cannot reach Codex.app.

### Windows

Use PowerShell/CIM:

```powershell
Get-CimInstance Win32_Process |
  Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |
  ConvertTo-Json -Compress
```

Primary positive signals:

- `Name = Codex.exe`;
- `ExecutablePath` ends with `\Codex.exe`;
- path is under one of:
  - `%LOCALAPPDATA%\Programs\Codex\`
  - `%LOCALAPPDATA%\Codex\`
  - `%PROGRAMFILES%\Codex\`
  - `%PROGRAMFILES%\OpenAI\Codex\`
  - a Squirrel-style `app-*` Codex directory;
- command line contains `resources\app.asar`;
- app-server child parent chain reaches `Codex.exe`;
- app-server child environment, when readable, contains `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`.

False positive exclusions:

- `codex.exe app-server` from a CLI/npm install unless parent chain reaches `Codex.exe`;
- Node app-server launched by CodexUI.

### Operational Rule

Process detection should be cached for 10 seconds. Scheduler `auto` mode should call `shouldRun()` on every tick:

- Desktop detected: do not tick CodexUI scheduler.
- Desktop not detected and detection supported: CodexUI fallback scheduler may tick.
- Detection unsupported or detection failed hard: do not tick CodexUI scheduler.

---

## Self-Review

Spec coverage:

- Shared TOML canonical definitions: Tasks 3-5 preserve `nativeStore.ts` definition ownership.
- Shared SQLite runtime state: Tasks 2-5 replace file runtime state with Desktop SQLite.
- Desktop scheduler ownership: Tasks 1 and 7 add cross-platform process detection and UI state.
- Windows/macOS/Linux process detection: Task 1 and the platform plan cover all three.
- No separate permissions policy: no task introduces a new policy layer; runner keeps existing app config/profile resolution.
- Seamless Desktop compatibility: Tasks 4-6 align tick, due state, jitter, heartbeat cooldown, and run statuses.

Placeholder scan:

- No `TBD`, `TODO`, or undefined broad "handle edge cases" instructions are present.

Type consistency:

- `DesktopAutomationRunStatus`, `DesktopAutomationStateRow`, and `AutomationRuntimeStore` are defined before they are referenced.
- `detectCodexDesktopFromSnapshot`, `detectCodexDesktopProcess`, and `detectCodexDesktopProcessDetails` names are consistent across tasks.
