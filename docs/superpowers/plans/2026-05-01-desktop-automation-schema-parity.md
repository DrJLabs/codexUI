# Desktop Automation Schema Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CodexUI read, preserve, write, display, and schedule Codex Desktop-style automation files, using the Desktop-created hourly fixture as the first compatibility target.

**Architecture:** Keep `$CODEX_HOME/automations/<automation-id>/automation.toml` as the shared Desktop-compatible source of truth for standard automation fields. Use `codexui.json` only for CodexUI-only metadata such as descriptions, notes, run profile ids, Kanban projection settings, diagnostics, and local UI state. Normalize Desktop-prefixed RRULE strings internally while preserving the original prefix on writeback.

**Tech Stack:** TypeScript, Node `fs/promises`, Express automations routes, Vue composables/components, Vitest, existing CodexUI automation native store/service/scheduler/runner modules.

---

## Current Verified Repo Truth

- `src/server/automations/nativeStore.ts` already parses `kind = "cron"`, but the service ignores `cron` records in list/schedule/run paths.
- `automation.toml` currently owns only `version`, `id`, `kind`, `name`, `prompt`, `status`, `rrule`, `target_thread_id`, `created_at`, and `updated_at`.
- `model`, `reasoningEffort`, `runMode`, and `cwd` currently come from `codexui.json`, not from native TOML.
- `serializeAutomationToml(record, previousRaw)` already preserves unknown top-level TOML fields and comments by merging known assignments into the previous file.
- Current serialization always writes `target_thread_id = ""` when `targetThreadId` is null.
- `schema.ts` and `scheduleCalculator.ts` currently expect bare RRULE strings like `FREQ=DAILY`, not Desktop strings like `RRULE:FREQ=DAILY`.
- `/Applications/Codex.app` is not available in this environment, so this implementation must treat the provided Desktop-created fixture as the compatibility oracle for this slice.

## Desktop Fixture Contract

Create this fixture exactly:

`fixtures/desktop-automations/hourly-fixture/automation.toml`

```toml
version = 1
id = "hourly-fixture"
kind = "cron"
name = "hourly fixture"
prompt = "Create a file in this repo that says \"hello\". If the \"hello\" file is already created, add a new line that says \"hello\" with a timestamp in the file."
status = "ACTIVE"
rrule = "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA"
model = "gpt-5.5"
reasoning_effort = "low"
execution_environment = "worktree"
cwds = ["/mnt/c/Users/projects/apollo"]
created_at = 1777654085276
updated_at = 1777654085276
```

Expected normalized CodexUI definition:

```ts
{
  id: 'hourly-fixture',
  kind: 'cron',
  name: 'hourly fixture',
  status: 'active',
  legacyStatus: 'ACTIVE',
  schedule: {
    type: 'rrule',
    rrule: 'FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA',
  },
  targetThreadId: null,
  cwd: '/mnt/c/Users/projects/apollo',
  cwds: ['/mnt/c/Users/projects/apollo'],
  runMode: 'worktree',
  model: 'gpt-5.5',
  reasoningEffort: 'low',
}
```

## Hardened Decisions

- `kind = "cron"` is the preferred kind for new Desktop-compatible scheduled automations.
- Legacy thread-attached records remain supported as `kind = "heartbeat"`.
- Service, scheduler, runner, and route lookup must consider both `heartbeat` and `cron`.
- Duplicate `targetThreadId` checks apply only when `targetThreadId` is non-null.
- `rrule` is normalized to bare `FREQ=...` at internal boundaries.
- Existing `RRULE:` prefix is preserved on writeback.
- New `cron` records are written with `RRULE:` prefix by default.
- New legacy `heartbeat` records can keep bare RRULE output unless created from or patched over a prefixed file.
- `target_thread_id` is written only when a real thread target exists, or when preserving an already-present key.
- `cwds` is the native TOML field. `cwd` is an internal convenience derived from `cwds[0]`.
- Full `cwds` arrays are preserved. Do not collapse the TOML array to a single path.
- `execution_environment = "worktree"` maps to `runMode = "worktree"`.
- Unknown `execution_environment` values are preserved and surfaced as warnings. They must not be deleted.
- `model` and `reasoning_effort` are native TOML fields for Desktop-compatible records.
- `codexui.json` remains valid as a legacy fallback for `cwd`, `runMode`, `model`, and `reasoningEffort`, but TOML wins when the field exists in TOML.
- `codexui.json` remains the source for `description`, `notes`, `runProfileId`, `kanbanProjection`, and other CodexUI-only state.
- Folder name for newly created records should equal the automation id. If no explicit id is provided, derive a safe id from `name`.
- Do not infer project, cwd, run mode, or target thread from folder name.

## File Structure

- Create: `fixtures/desktop-automations/hourly-fixture/automation.toml`
  - Owns the canonical Desktop compatibility fixture for this slice.
- Modify: `src/types/automations.ts`
  - Widen automation kinds and add `cwds`.
- Modify: `src/server/automations/nativeStore.ts`
  - Parse and serialize Desktop-native fields, string arrays, conditional `target_thread_id`, RRULE prefix preservation, and id-derived folder naming.
- Modify: `src/server/automations/schema.ts`
  - Accept `cron` creates, normalize RRULE input, and preserve existing create/patch validation rules.
- Modify: `src/server/automations/scheduleCalculator.ts`
  - Evaluate Desktop-prefixed RRULE strings through the same normalized scheduler path.
- Modify: `src/server/automations/service.ts`
  - Map native TOML execution fields into definitions, list/schedule/run `cron` records, and write standard fields back to TOML.
- Modify: `src/server/automations/runner.ts`
  - Preserve `definition.kind` and native execution fields in projection/recovery helper records.
- Modify: `src/api/automationsGateway.ts`
  - Allow `kind: 'cron'` in create payload typing.
- Modify: `src/composables/useAutomations.ts`
  - Default new scheduled automations to `cron` when not thread-attached and preserve `cwds`.
- Modify: `src/components/automations/AutomationsPage.vue`
  - Display `cron` kinds and Desktop-derived cwd/run mode/model values without treating null `targetThreadId` as an error.
- Tests:
  - Modify: `src/server/automations/__tests__/nativeStore.test.ts`
  - Modify: `src/server/automations/__tests__/scheduleCalculator.test.ts`
  - Modify: `src/server/automations/__tests__/routes.test.ts`
  - Modify: `src/server/automations/__tests__/scheduler.test.ts`
  - Modify: `src/server/automations/__tests__/runner.test.ts`
  - Modify: `src/composables/useAutomations.test.ts`
  - Modify: `src/api/automationsGateway.test.ts`
- Modify: `tests.md`
  - Add manual verification steps for Desktop fixture import/list/schedule visibility. Browser screenshots are not required unless Playwright verification is explicitly requested.

---

## Task 1: Desktop Fixture And Native Parsing

**Files:**
- Create: `fixtures/desktop-automations/hourly-fixture/automation.toml`
- Modify: `src/server/automations/nativeStore.ts`
- Modify: `src/server/automations/__tests__/nativeStore.test.ts`

- [ ] **Step 1: Add the fixture**

Create `fixtures/desktop-automations/hourly-fixture/automation.toml` with the exact fixture from the `Desktop Fixture Contract` section.

- [ ] **Step 2: Write failing parse tests**

Add tests in `src/server/automations/__tests__/nativeStore.test.ts`:

```ts
it('parses Desktop cron automation fields from the canonical fixture', async () => {
  const raw = await readFile('fixtures/desktop-automations/hourly-fixture/automation.toml', 'utf8')

  expect(parseAutomationToml(raw)).toMatchObject({
    id: 'hourly-fixture',
    kind: 'cron',
    name: 'hourly fixture',
    status: 'ACTIVE',
    rrule: 'FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA',
    rrulePrefix: 'RRULE:',
    model: 'gpt-5.5',
    reasoningEffort: 'low',
    executionEnvironment: 'worktree',
    runMode: 'worktree',
    cwd: '/mnt/c/Users/projects/apollo',
    cwds: ['/mnt/c/Users/projects/apollo'],
    targetThreadId: null,
    createdAtMs: 1777654085276,
    updatedAtMs: 1777654085276,
  })
})

it('parses TOML string arrays for cwds without dropping additional paths', () => {
  const raw = [
    'version = 1',
    'id = "multi-cwd"',
    'kind = "cron"',
    'name = "Multi cwd"',
    'prompt = "Run"',
    'status = "ACTIVE"',
    'rrule = "RRULE:FREQ=DAILY"',
    'execution_environment = "worktree"',
    'cwds = ["/repo/one", "/repo/two"]',
    'created_at = 1777654085276',
    'updated_at = 1777654085276',
    '',
  ].join('\n')

  expect(parseAutomationToml(raw)).toMatchObject({
    cwd: '/repo/one',
    cwds: ['/repo/one', '/repo/two'],
  })
})
```

Run:

```bash
pnpm exec vitest run src/server/automations/__tests__/nativeStore.test.ts
```

Expected before implementation: fail because `model`, `reasoningEffort`, `executionEnvironment`, `runMode`, `cwd`, `cwds`, and `rrulePrefix` are not parsed today.

- [ ] **Step 3: Extend native record types**

In `src/server/automations/nativeStore.ts`, extend `ThreadAutomationRecord`:

```ts
export type ThreadAutomationRecord = {
  id: string
  kind: 'heartbeat' | 'cron'
  name: string
  prompt: string
  rrule: string
  rrulePrefix: 'RRULE:' | null
  status: ThreadAutomationStatus
  targetThreadId: string | null
  model: string | null
  reasoningEffort: string | null
  executionEnvironment: string | null
  runMode: 'chat' | 'local' | 'worktree' | null
  cwd: string | null
  cwds: string[]
  createdAtMs: number | null
  updatedAtMs: number | null
  nextRunAtMs: number | null
}
```

Update existing test fixtures in the same file to include:

```ts
rrulePrefix: null,
model: null,
reasoningEffort: null,
executionEnvironment: null,
runMode: null,
cwd: null,
cwds: [],
```

- [ ] **Step 4: Add small TOML helpers**

In `src/server/automations/nativeStore.ts`, add helpers near the string TOML helpers:

```ts
function normalizeAutomationRruleForRead(value: string): { rrule: string; rrulePrefix: 'RRULE:' | null } {
  const trimmed = value.trim()
  if (trimmed.startsWith('RRULE:')) {
    return { rrule: trimmed.slice('RRULE:'.length), rrulePrefix: 'RRULE:' }
  }
  return { rrule: trimmed, rrulePrefix: null }
}

function readTomlStringArray(value: string): string[] | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  const body = trimmed.slice(1, -1).trim()
  if (!body) return []
  const values: string[] = []
  let index = 0
  while (index < body.length) {
    while (body[index] === ' ' || body[index] === '\t' || body[index] === ',') index += 1
    if (index >= body.length) break
    const quote = body[index]
    if (quote !== '"' && quote !== "'") return null
    let end = index + 1
    let escaped = false
    while (end < body.length) {
      const char = body[end]
      if (quote === '"' && !escaped && char === '\\') {
        escaped = true
        end += 1
        continue
      }
      if (!escaped && char === quote) break
      escaped = false
      end += 1
    }
    if (end >= body.length) return null
    values.push(readTomlString(body.slice(index, end + 1)))
    index = end + 1
    while (body[index] === ' ' || body[index] === '\t') index += 1
    if (index < body.length && body[index] !== ',') return null
  }
  return values
}

function runModeFromExecutionEnvironment(value: string | null): 'chat' | 'local' | 'worktree' | null {
  if (value === 'chat' || value === 'local' || value === 'worktree') return value
  return null
}
```

- [ ] **Step 5: Parse Desktop fields**

Update `parseAutomationToml(raw)`:

```ts
const normalizedRrule = normalizeAutomationRruleForRead(readTomlString(values.rrule ?? ''))
const model = readTomlString(values.model ?? '') || null
const reasoningEffort = readTomlString(values.reasoning_effort ?? '') || null
const executionEnvironment = readTomlString(values.execution_environment ?? '') || null
const cwds = readTomlStringArray(values.cwds ?? '') ?? []
const cwd = cwds[0] ?? null
const runMode = runModeFromExecutionEnvironment(executionEnvironment)
```

Return these fields on the record:

```ts
rrule: normalizedRrule.rrule,
rrulePrefix: normalizedRrule.rrulePrefix,
model,
reasoningEffort,
executionEnvironment,
runMode,
cwd,
cwds,
```

- [ ] **Step 6: Run Task 1 tests**

```bash
pnpm exec vitest run src/server/automations/__tests__/nativeStore.test.ts
```

Expected: all native store tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add fixtures/desktop-automations/hourly-fixture/automation.toml src/server/automations/nativeStore.ts src/server/automations/__tests__/nativeStore.test.ts
git commit -m "feat(automations): parse desktop automation fields"
```

## Task 2: Native Serialization And Preservation

**Files:**
- Modify: `src/server/automations/nativeStore.ts`
- Modify: `src/server/automations/__tests__/nativeStore.test.ts`

- [ ] **Step 1: Write failing serialization tests**

Add tests:

```ts
it('preserves Desktop cron fields and omits empty target_thread_id on no-op writeback', async () => {
  const previousRaw = await readFile('fixtures/desktop-automations/hourly-fixture/automation.toml', 'utf8')
  const record = parseAutomationToml(previousRaw)
  expect(record).not.toBeNull()

  const nextRaw = serializeAutomationToml(record!, previousRaw)

  expect(nextRaw).toContain('kind = "cron"')
  expect(nextRaw).toContain('rrule = "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA"')
  expect(nextRaw).toContain('model = "gpt-5.5"')
  expect(nextRaw).toContain('reasoning_effort = "low"')
  expect(nextRaw).toContain('execution_environment = "worktree"')
  expect(nextRaw).toContain('cwds = ["/mnt/c/Users/projects/apollo"]')
  expect(nextRaw).not.toContain('target_thread_id = ""')
})

it('keeps an existing empty target_thread_id key when preserving a legacy file that already had one', () => {
  const previousRaw = `${serializeAutomationToml({
    ...pausedRecord,
    targetThreadId: null,
  })}desktop_only = "keep"\n`
  const record = parseAutomationToml(previousRaw)
  expect(record).not.toBeNull()

  const nextRaw = serializeAutomationToml(record!, previousRaw)

  expect(nextRaw).toContain('target_thread_id = ""')
  expect(nextRaw).toContain('desktop_only = "keep"')
})
```

Run:

```bash
pnpm exec vitest run src/server/automations/__tests__/nativeStore.test.ts
```

Expected before implementation: fail because known Desktop fields are not serialized and null thread ids are always written.

- [ ] **Step 2: Add TOML array serializer and key-presence helper**

Add:

```ts
function serializeTomlStringArray(values: string[]): string {
  return `[${values.map((value) => serializeTomlString(value)).join(', ')}]`
}

function previousRawHasTopLevelKey(previousRaw: string | undefined, key: string): boolean {
  if (typeof previousRaw !== 'string') return false
  let multilineStringDelimiter: '"""' | "'''" | null = null
  for (const line of previousRaw.split(/\r?\n/u)) {
    if (multilineStringDelimiter) {
      if (findTomlMultilineCloseIndex(line, multilineStringDelimiter) >= 0) multilineStringDelimiter = null
      continue
    }
    const assignment = readTopLevelTomlAssignment(line)
    if (!assignment) continue
    if (assignment.key === key) return true
    multilineStringDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
  }
  return false
}
```

- [ ] **Step 3: Make field building context-aware**

Change:

```ts
function buildAutomationTomlFields(record: ThreadAutomationRecord): Record<string, string>
```

to:

```ts
function buildAutomationTomlFields(record: ThreadAutomationRecord, previousRaw?: string): Record<string, string>
```

Build fields in this order:

```ts
const fields: Record<string, string> = {
  version: '1',
  id: serializeTomlString(record.id),
  kind: serializeTomlString(record.kind),
  name: serializeTomlString(record.name),
  prompt: serializeTomlString(record.prompt),
  status: serializeTomlString(record.status),
  rrule: serializeTomlString(`${record.rrulePrefix ?? (record.kind === 'cron' ? 'RRULE:' : '')}${record.rrule}`),
}
if (record.model) fields.model = serializeTomlString(record.model)
if (record.reasoningEffort) fields.reasoning_effort = serializeTomlString(record.reasoningEffort)
if (record.executionEnvironment) fields.execution_environment = serializeTomlString(record.executionEnvironment)
if (record.cwds.length > 0) fields.cwds = serializeTomlStringArray(record.cwds)
if (record.targetThreadId || previousRawHasTopLevelKey(previousRaw, 'target_thread_id')) {
  fields.target_thread_id = serializeTomlString(record.targetThreadId ?? '')
}
fields.created_at = String(record.createdAtMs ?? Date.now())
fields.updated_at = String(record.updatedAtMs ?? Date.now())
return fields
```

Update `serializeAutomationToml()` to call:

```ts
const fields = buildAutomationTomlFields(record, previousRaw)
```

- [ ] **Step 4: Run Task 2 tests**

```bash
pnpm exec vitest run src/server/automations/__tests__/nativeStore.test.ts
```

Expected: all native store tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/server/automations/nativeStore.ts src/server/automations/__tests__/nativeStore.test.ts
git commit -m "feat(automations): preserve desktop automation toml"
```

## Task 3: RRULE Normalization Across API And Scheduler

**Files:**
- Modify: `src/server/automations/schema.ts`
- Modify: `src/server/automations/scheduleCalculator.ts`
- Modify: `src/server/automations/__tests__/scheduleCalculator.test.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing scheduler and route tests**

Add to `scheduleCalculator.test.ts`:

```ts
it('accepts Desktop-prefixed RRULE strings through scheduler normalization', () => {
  const decision = evaluateRruleSchedule({
    rrule: 'RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA',
    anchorIso: '2026-04-30T00:00:00.000Z',
    nextDueAtIso: null,
    nowIso: '2026-04-30T00:30:00.000Z',
  })

  expect(decision.nextDueAtIso).toBe('2026-04-30T01:00:00.000Z')
  expect(decision.unsupportedReason).toBeNull()
})
```

Add a route/schema test that `parseAutomationCreateInput()` accepts:

```ts
{
  kind: 'cron',
  name: 'Hourly',
  prompt: 'Run',
  schedule: { type: 'rrule', rrule: 'RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0' },
  targetThreadId: null,
  cwd: '/tmp',
  runMode: 'worktree',
}
```

and returns `schedule.rrule === 'FREQ=HOURLY;INTERVAL=1;BYMINUTE=0'`.

Run:

```bash
pnpm exec vitest run src/server/automations/__tests__/scheduleCalculator.test.ts src/server/automations/__tests__/routes.test.ts
```

Expected before implementation: fail because `RRULE:` is treated as an invalid key and create only accepts `heartbeat`.

- [ ] **Step 2: Add shared normalization in `schema.ts`**

Add:

```ts
export function normalizeAutomationRrule(rrule: string): string {
  const trimmed = rrule.trim()
  return trimmed.startsWith('RRULE:') ? trimmed.slice('RRULE:'.length) : trimmed
}
```

Change `readSchedule()`:

```ts
const rrule = normalizeAutomationRrule(readTrimmedString(value.rrule, 'schedule.rrule'))
validateRrule(rrule)
return { type: 'rrule', rrule }
```

Change create typing and validation:

```ts
export type AutomationCreateInput = {
  kind: 'heartbeat' | 'cron'
  ...
}
```

```ts
if (value.kind !== 'heartbeat' && value.kind !== 'cron') {
  throw new AutomationValidationError('kind must be heartbeat or cron')
}
```

Return:

```ts
kind: value.kind,
```

- [ ] **Step 3: Use normalization in scheduler**

Import or duplicate the small normalization helper in `scheduleCalculator.ts` without creating a server import cycle:

```ts
function normalizeAutomationRrule(rrule: string): string {
  const trimmed = rrule.trim()
  return trimmed.startsWith('RRULE:') ? trimmed.slice('RRULE:'.length) : trimmed
}
```

Change:

```ts
for (const rawPart of rrule.split(';')) {
```

to:

```ts
for (const rawPart of normalizeAutomationRrule(rrule).split(';')) {
```

- [ ] **Step 4: Run Task 3 tests**

```bash
pnpm exec vitest run src/server/automations/__tests__/scheduleCalculator.test.ts src/server/automations/__tests__/routes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/server/automations/schema.ts src/server/automations/scheduleCalculator.ts src/server/automations/__tests__/scheduleCalculator.test.ts src/server/automations/__tests__/routes.test.ts
git commit -m "feat(automations): normalize desktop rrule strings"
```

## Task 4: Service Mapping And Cron Scheduling

**Files:**
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/runner.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`
- Modify: `src/server/automations/__tests__/scheduler.test.ts`
- Modify: `src/server/automations/__tests__/runner.test.ts`

- [ ] **Step 1: Write failing service/list tests**

Add route/service coverage that copies the fixture into a temp Codex home:

```ts
const codexHomeDir = await createCodexHome()
const automationDir = join(codexHomeDir, 'automations', 'hourly-fixture')
await mkdir(automationDir, { recursive: true })
await writeFile(
  join(automationDir, 'automation.toml'),
  await readFile('fixtures/desktop-automations/hourly-fixture/automation.toml', 'utf8'),
  'utf8',
)
```

Assert `/codex-api/automations/state` includes:

```ts
expect(definition).toMatchObject({
  id: 'hourly-fixture',
  kind: 'cron',
  targetThreadId: null,
  cwd: '/mnt/c/Users/projects/apollo',
  cwds: ['/mnt/c/Users/projects/apollo'],
  runMode: 'worktree',
  model: 'gpt-5.5',
  reasoningEffort: 'low',
  schedule: {
    type: 'rrule',
    rrule: 'FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA',
  },
})
```

Add scheduler coverage that `service.listSchedulerEntries()` includes the fixture as a candidate when status is active.

Run:

```bash
pnpm exec vitest run src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/scheduler.test.ts
```

Expected before implementation: fail because service filters to `heartbeat`.

- [ ] **Step 2: Widen public types**

In `src/types/automations.ts`:

```ts
export type AutomationKind = 'heartbeat' | 'cron'
```

Add to `AutomationExecution`:

```ts
cwds: string[]
```

Update test fixtures that build `AutomationDefinition` to include `cwds: []` unless a specific value is under test.

- [ ] **Step 3: Make service consider both native kinds**

In `service.ts`, add:

```ts
function isSchedulableAutomationKind(kind: ThreadAutomationRecord['kind']): boolean {
  return kind === 'heartbeat' || kind === 'cron'
}
```

Replace filters like:

```ts
if (entry.record.kind !== 'heartbeat') continue
```

with:

```ts
if (!isSchedulableAutomationKind(entry.record.kind)) continue
```

Do this in:

- `listSchedulerEntries()`
- `listPersistedActiveRuns()`
- `recoverInterruptedRunsNow()`
- `findEntry()`
- `listDefinitionsWithDiagnostics()`

Keep duplicate target-thread checks constrained to non-null target thread ids.

- [ ] **Step 4: Map native TOML fields over sidecar fallback**

In `mapDefinition()`, change:

```ts
kind: 'heartbeat',
cwd: sidecar.cwd,
runMode: sidecar.runMode,
model: sidecar.model,
reasoningEffort: sidecar.reasoningEffort,
```

to:

```ts
kind: entry.record.kind,
cwd: entry.record.cwd ?? sidecar.cwd,
cwds: entry.record.cwds.length > 0 ? entry.record.cwds : sidecar.cwd ? [sidecar.cwd] : [],
runMode: entry.record.runMode ?? sidecar.runMode,
model: entry.record.model ?? sidecar.model,
reasoningEffort: entry.record.reasoningEffort ?? sidecar.reasoningEffort,
```

Add a warning diagnostic when `entry.record.executionEnvironment` is non-null and `entry.record.runMode` is null:

```ts
{
  automationId: entry.record.id,
  sourceDirName: entry.sourceDirName,
  path: entry.automationTomlPath,
  severity: 'warning',
  message: `Unsupported automation execution_environment: ${entry.record.executionEnvironment}`,
}
```

- [ ] **Step 5: Preserve kind and fields in runner projection helpers**

In `runner.ts`, update projection definitions and `createNativeEntryForRun()` to use:

```ts
kind: definition.kind,
model: definition.model,
reasoningEffort: definition.reasoningEffort,
executionEnvironment: definition.runMode,
runMode: definition.runMode,
cwd: definition.cwd,
cwds: definition.cwds,
rrulePrefix: definition.kind === 'cron' ? 'RRULE:' : null,
```

Keep `executionEnvironment` as the original parsed string when available on native records. For projected definitions that only have `runMode`, `worktree`, `local`, and `chat` are acceptable values.

- [ ] **Step 6: Run Task 4 tests**

```bash
pnpm exec vitest run \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/__tests__/scheduler.test.ts \
  src/server/automations/__tests__/runner.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/types/automations.ts src/server/automations/service.ts src/server/automations/runner.ts src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/scheduler.test.ts src/server/automations/__tests__/runner.test.ts
git commit -m "feat(automations): list and schedule desktop cron records"
```

## Task 5: Create/Patch Writes Desktop-Compatible Native Fields

**Files:**
- Modify: `src/server/automations/nativeStore.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/schema.ts`
- Modify: `src/server/automations/__tests__/routes.test.ts`
- Modify: `src/server/automations/__tests__/nativeStore.test.ts`

- [ ] **Step 1: Write failing create/patch persistence tests**

Add route tests proving a new worktree scheduled automation:

```json
{
  "kind": "cron",
  "name": "hourly fixture",
  "prompt": "Run",
  "schedule": { "type": "rrule", "rrule": "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0" },
  "targetThreadId": null,
  "cwd": "/mnt/c/Users/projects/apollo",
  "runMode": "worktree",
  "model": "gpt-5.5",
  "reasoningEffort": "low",
  "kanbanProjection": { "mode": "off" },
  "notes": ""
}
```

writes:

```toml
id = "hourly-fixture"
kind = "cron"
rrule = "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0"
model = "gpt-5.5"
reasoning_effort = "low"
execution_environment = "worktree"
cwds = ["/mnt/c/Users/projects/apollo"]
```

and does not write:

```toml
target_thread_id = ""
```

Add a patch test proving `model`, `reasoningEffort`, `runMode`, and `cwd` update TOML, not only `codexui.json`.

- [ ] **Step 2: Extend create input with optional id if needed**

If the API already computes ids internally, do not expose `id` in the browser create payload. Keep id creation in the server.

If a server test needs explicit id control, add this server-only optional field:

```ts
id?: string | null
```

Validate it with the same safe basename rules used by native store. Browser UI does not need to send this field for this slice.

- [ ] **Step 3: Generalize native write function naming**

Keep exported aliases for existing callers, but introduce neutral names:

```ts
export async function writeNativeAutomationBySourceDir(
  sourceDirName: string,
  record: ThreadAutomationRecord,
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationRecord>
```

Then keep:

```ts
export const writeNativeHeartbeatAutomationBySourceDir = writeNativeAutomationBySourceDir
```

Add a create helper:

```ts
export async function writeNativeAutomation(
  input: {
    id?: string | null
    kind: 'heartbeat' | 'cron'
    threadId: string | null
    name: string
    prompt: string
    rrule: string
    status: ThreadAutomationStatus
    model?: string | null
    reasoningEffort?: string | null
    runMode?: 'chat' | 'local' | 'worktree' | null
    cwd?: string | null
    cwds?: string[]
  },
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationRecord>
```

Make `writeThreadHeartbeatAutomation()` delegate to `writeNativeAutomation({ kind: 'heartbeat', ... })`.

- [ ] **Step 4: Write standard fields from service create/patch**

In `createDefinition()`, call the neutral helper with:

```ts
kind: input.kind,
model: input.model,
reasoningEffort: input.reasoningEffort,
runMode: input.runMode,
cwd: input.cwd,
cwds: input.cwd ? [input.cwd] : [],
```

In `patchDefinition()`, build `nextRecord` with:

```ts
model: hasOwn(patch, 'model') ? patch.model ?? null : entry.record.model,
reasoningEffort: hasOwn(patch, 'reasoningEffort') ? patch.reasoningEffort ?? null : entry.record.reasoningEffort,
runMode: hasOwn(patch, 'runMode') ? patch.runMode ?? null : entry.record.runMode,
executionEnvironment: hasOwn(patch, 'runMode') ? patch.runMode ?? null : entry.record.executionEnvironment,
cwd: hasOwn(patch, 'cwd') ? patch.cwd ?? null : entry.record.cwd,
cwds: hasOwn(patch, 'cwd') ? patch.cwd ? [patch.cwd] : [] : entry.record.cwds,
```

Keep sidecar writes for legacy fallback during this migration. The record values must win during read mapping.

- [ ] **Step 5: Run Task 5 tests**

```bash
pnpm exec vitest run src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/nativeStore.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/server/automations/nativeStore.ts src/server/automations/service.ts src/server/automations/schema.ts src/server/automations/__tests__/routes.test.ts src/server/automations/__tests__/nativeStore.test.ts
git commit -m "feat(automations): write desktop native fields"
```

## Task 6: Frontend Types, Drafts, And Display

**Files:**
- Modify: `src/api/automationsGateway.ts`
- Modify: `src/composables/useAutomations.ts`
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `src/api/automationsGateway.test.ts`
- Modify: `src/composables/useAutomations.test.ts`

- [ ] **Step 1: Write failing API/composable tests**

Add API fixture assertions that an automation definition can have:

```ts
kind: 'cron',
targetThreadId: null,
cwd: '/mnt/c/Users/projects/apollo',
cwds: ['/mnt/c/Users/projects/apollo'],
runMode: 'worktree',
model: 'gpt-5.5',
reasoningEffort: 'low',
```

Add composable tests proving:

- Creating from an empty draft with `runMode = 'worktree'` and no thread target sends `kind: 'cron'`.
- Editing a Desktop fixture preserves `targetThreadId: null`.
- Saving a draft with cwd sends the cwd field exactly once.

Run:

```bash
pnpm exec vitest run src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
```

Expected before implementation: fail on kind typing or missing `cwds`.

- [ ] **Step 2: Update API and composable types**

In `src/api/automationsGateway.ts`:

```ts
export type CreateAutomationInput = {
  kind: 'heartbeat' | 'cron'
  ...
}
```

In `src/composables/useAutomations.ts`, add `cwds` to drafts if the UI needs to display the full array. Keep user editing focused on the primary `cwd` field for this slice.

Set create kind in `toCreateInput()`:

```ts
kind: draft.targetThreadId.trim() ? 'heartbeat' : 'cron',
```

If an existing selected definition has `kind`, preserve it during edit by keeping kind out of patch payload unless a future UI exposes kind changes.

- [ ] **Step 3: Update Automations page display**

In `AutomationsPage.vue`:

- Show `definition.kind` in the table or detail metadata.
- Keep `No thread` display for null `targetThreadId`.
- Show `definition.cwd || definition.cwds[0] || 'n/a'` where cwd is relevant.
- Do not require a thread id when `draft.runMode` is `local` or `worktree`.

- [ ] **Step 4: Run Task 6 tests**

```bash
pnpm exec vitest run src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/api/automationsGateway.ts src/composables/useAutomations.ts src/components/automations/AutomationsPage.vue src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts
git commit -m "feat(automations): surface desktop cron definitions"
```

## Task 7: Manual Test Documentation And Final Verification

**Files:**
- Modify: `tests.md`
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`

- [ ] **Step 1: Update manual test documentation**

Append this section to `tests.md`:

```markdown
### Feature: Desktop automation TOML compatibility

Prerequisites/setup:
- Start CodexUI with a temporary `CODEX_HOME` or test profile.
- Copy `fixtures/desktop-automations/hourly-fixture/automation.toml` to `$CODEX_HOME/automations/hourly-fixture/automation.toml`.
- Ensure the automations feature is enabled in the server configuration used for the run.

Steps:
1. Open the Automations page.
2. Confirm `hourly fixture` appears in the automation list.
3. Select `hourly fixture`.
4. Confirm the kind is `cron`, status is active, target thread shows no thread, run mode is worktree, cwd is `/mnt/c/Users/projects/apollo`, model is `gpt-5.5`, and reasoning effort is `low`.
5. Save the automation without changing fields.
6. Reopen `$CODEX_HOME/automations/hourly-fixture/automation.toml`.
7. Confirm `rrule` still starts with `RRULE:`, `cwds` is still an array, `model` and `reasoning_effort` are present, and empty `target_thread_id` was not added.
8. Switch to dark theme and repeat steps 1-4.

Expected results:
- Desktop-created cron records list and open without a thread target.
- Scheduler accepts the Desktop-prefixed RRULE.
- No-op save preserves Desktop TOML fields and unknown fields.
- Light and dark themes both render the automation fields readably.

Rollback/cleanup:
- Remove `$CODEX_HOME/automations/hourly-fixture/` from the temporary profile.
```

- [ ] **Step 2: Link this plan from the high-level plan**

Add near the existing detailed phase-plan links in `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`:

```markdown
Desktop automation TOML compatibility is tracked in [Desktop Automation Schema Parity Implementation Plan](./2026-05-01-desktop-automation-schema-parity.md).
```

- [ ] **Step 3: Run targeted verification**

```bash
pnpm exec vitest run \
  src/server/automations/__tests__/nativeStore.test.ts \
  src/server/automations/__tests__/scheduleCalculator.test.ts \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/__tests__/scheduler.test.ts \
  src/server/automations/__tests__/runner.test.ts \
  src/api/automationsGateway.test.ts \
  src/composables/useAutomations.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 4: Run build**

```bash
pnpm run build
```

Expected: frontend and CLI builds complete successfully.

- [ ] **Step 5: Commit Task 7**

```bash
git add tests.md docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md
git commit -m "docs(automations): document desktop automation compatibility checks"
```

## Risk Checks Before Merge

- Confirm no code path writes `target_thread_id = ""` for a new null-thread cron record.
- Confirm `serializeAutomationToml(record, previousRaw)` still preserves unknown Desktop fields and comments.
- Confirm `RRULE:` is never passed unnormalized into validation or scheduler internals.
- Confirm `cron` records are listed, scheduled, runnable, and recoverable.
- Confirm legacy heartbeat routes still return uppercase `ACTIVE` and `PAUSED`.
- Confirm sidecar-only fields remain in `codexui.json`.
- Confirm model/reasoning/run-mode/cwd read from TOML override stale sidecar values.
- Confirm tests include both canonical Desktop fixture import and CodexUI-created cron writeback.

## Final Verification Commands

Run:

```bash
pnpm exec vitest run \
  src/server/automations/__tests__/nativeStore.test.ts \
  src/server/automations/__tests__/scheduleCalculator.test.ts \
  src/server/automations/__tests__/routes.test.ts \
  src/server/automations/__tests__/scheduler.test.ts \
  src/server/automations/__tests__/runner.test.ts \
  src/api/automationsGateway.test.ts \
  src/composables/useAutomations.test.ts
pnpm run build
```

Expected:

```text
Test Files  7 passed
```

The exact test count may change as coverage is added. Treat any failure as a blocker.

## Completion Report Requirements

Report:

- Fixture path created.
- Exact Desktop fields now parsed from TOML.
- Exact Desktop fields now written to TOML.
- Whether unknown fields/comments are preserved.
- Whether `target_thread_id` is omitted for null-thread cron records.
- Whether scheduler accepts the Desktop-prefixed RRULE.
- Verification commands and results.
- Any Desktop parity gap caused by the missing `/Applications/Codex.app` inspection environment.

