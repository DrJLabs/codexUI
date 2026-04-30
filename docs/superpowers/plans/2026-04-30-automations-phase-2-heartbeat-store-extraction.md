# Automations Phase 2 Heartbeat Store Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the existing thread heartbeat automation parser/store from `codexAppServerBridge.ts` into focused Automations server modules while preserving the legacy thread automation API contract.

**Architecture:** Add `src/server/automations/nativeStore.ts` as the native `$CODEX_HOME/automations` filesystem boundary and `src/server/automations/legacyAdapter.ts` as the legacy response/input boundary. Keep the existing `/codex-api/thread-automation*` routes inside the generic bridge for this slice, but make them call the extracted store functions. Unit tests target parser/serializer/list/read/write/delete behavior with synthetic fixtures because Phase 0 found no host-local automation records.

**Tech Stack:** TypeScript, Node `fs/promises`, Vitest, existing CodexUI Express bridge.

---

## File Structure

- Create: `src/server/automations/nativeStore.ts`
  - Owns `automation.toml` parsing, serialization, slug generation, listing, reading, writing, and deleting.
  - Exports `ThreadAutomationStatus`, `ThreadAutomationRecord`, `parseAutomationToml`, `serializeAutomationToml`, `listThreadHeartbeatAutomations`, `readThreadHeartbeatAutomation`, `writeThreadHeartbeatAutomation`, and `deleteThreadHeartbeatAutomation`.
- Create: `src/server/automations/legacyAdapter.ts`
  - Owns legacy uppercase status normalization and write-input parsing helpers.
- Create: `src/server/automations/__tests__/nativeStore.test.ts`
  - Unit tests for round trip, uppercase statuses, invalid skip behavior, unknown-field parse tolerance, and filesystem operations.
- Modify: `src/server/codexAppServerBridge.ts`
  - Remove private automation store implementation and import from `nativeStore.ts` and `legacyAdapter.ts`.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Link Phase 2 implementation plan.
- Modify: `tests.md`
  - Add manual/automated verification for Phase 2.

## Task 1: Native Store Extraction With Tests

**Files:**
- Create: `src/server/automations/nativeStore.ts`
- Create: `src/server/automations/legacyAdapter.ts`
- Create: `src/server/automations/__tests__/nativeStore.test.ts`

- [ ] **Step 1: Write failing native-store tests**

Create `src/server/automations/__tests__/nativeStore.test.ts` with tests that import from `../nativeStore`.

Required test cases:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deleteThreadHeartbeatAutomation,
  listThreadHeartbeatAutomations,
  parseAutomationToml,
  readThreadHeartbeatAutomation,
  serializeAutomationToml,
  writeThreadHeartbeatAutomation,
} from '../nativeStore'

describe('automation native store', () => {
  it('round trips legacy heartbeat automation TOML with uppercase status', () => {
    const record = {
      id: 'heartbeat-thread-1',
      kind: 'heartbeat' as const,
      name: 'Thread automation',
      prompt: 'Check the thread',
      rrule: 'FREQ=DAILY',
      status: 'PAUSED' as const,
      targetThreadId: 'thread_1',
      createdAtMs: 1,
      updatedAtMs: 2,
      nextRunAtMs: null,
    }

    expect(parseAutomationToml(serializeAutomationToml(record))).toEqual(record)
  })

  it('tolerates unknown top-level TOML fields while parsing known fields', () => {
    const parsed = parseAutomationToml([
      'version = 1',
      'id = "heartbeat-thread-1"',
      'kind = "heartbeat"',
      'name = "Thread automation"',
      'prompt = "Check the thread"',
      'status = "ACTIVE"',
      'rrule = "FREQ=DAILY"',
      'target_thread_id = "thread_1"',
      'unknown_desktop_field = "preserve elsewhere"',
    ].join('\n'))

    expect(parsed).toMatchObject({
      id: 'heartbeat-thread-1',
      kind: 'heartbeat',
      status: 'ACTIVE',
      targetThreadId: 'thread_1',
    })
  })

  it('returns null for invalid or partial records', () => {
    expect(parseAutomationToml('id = "missing-required-fields"\n')).toBeNull()
    expect(parseAutomationToml([
      'id = "bad-status"',
      'kind = "heartbeat"',
      'name = "Bad"',
      'prompt = "Bad"',
      'status = "disabled"',
      'rrule = "FREQ=DAILY"',
    ].join('\n'))).toBeNull()
  })

  it('lists, reads, writes, and deletes thread heartbeat automations in a provided root', async () => {
    const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automations-'))

    const saved = await writeThreadHeartbeatAutomation({
      codexHomeDir,
      threadId: 'thread_1',
      name: 'Thread automation',
      prompt: 'Check the thread',
      rrule: 'FREQ=DAILY',
      status: 'ACTIVE',
    })

    const raw = await readFile(join(codexHomeDir, 'automations', saved.id, 'automation.toml'), 'utf8')
    expect(raw).toContain('status = "ACTIVE"')
    expect(await readFile(join(codexHomeDir, 'automations', saved.id, 'memory.md'), 'utf8')).toBe('')
    await writeFile(join(codexHomeDir, 'automations', 'partial', 'automation.toml'), 'id = "partial"\n', 'utf8').catch(async () => {
      throw new Error('partial fixture directory must be created before writing')
    })

    expect(await readThreadHeartbeatAutomation('thread_1', { codexHomeDir })).toMatchObject({ id: saved.id })
    expect(Object.keys(await listThreadHeartbeatAutomations({ codexHomeDir }))).toEqual(['thread_1'])
    expect(await deleteThreadHeartbeatAutomation('thread_1', { codexHomeDir })).toBe(true)
    expect(await readThreadHeartbeatAutomation('thread_1', { codexHomeDir })).toBeNull()
  })
})
```

Before finalizing, fix the partial fixture setup by creating its parent directory with `mkdir(..., { recursive: true })`.

- [ ] **Step 2: Run RED test**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/nativeStore.test.ts
```

Expected: FAIL because `nativeStore.ts` does not exist yet.

- [ ] **Step 3: Implement `nativeStore.ts`**

Move the current bridge implementation into `src/server/automations/nativeStore.ts`, preserving behavior. Add optional dependency injection:

```ts
export type AutomationStoreOptions = {
  codexHomeDir?: string
}

function getCodexHomeDir(options: AutomationStoreOptions = {}): string {
  const injected = options.codexHomeDir?.trim()
  if (injected) return injected
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}
```

All filesystem functions accept `options?: AutomationStoreOptions`.

Export `readAutomationRecordFromFile` only if tests need it; otherwise keep it private.

- [ ] **Step 4: Implement `legacyAdapter.ts`**

Create:

```ts
import type { ThreadAutomationStatus } from './nativeStore'

export function normalizeThreadAutomationStatus(value: unknown): ThreadAutomationStatus {
  return value === 'PAUSED' ? 'PAUSED' : 'ACTIVE'
}

export type ThreadAutomationWritePayload = {
  threadId: string
  name: string
  prompt: string
  rrule: string
  status: ThreadAutomationStatus
}

export function parseThreadAutomationWritePayload(payload: Record<string, unknown> | null): ThreadAutomationWritePayload {
  return {
    threadId: typeof payload?.threadId === 'string' ? payload.threadId.trim() : '',
    name: typeof payload?.name === 'string' ? payload.name.trim() : '',
    prompt: typeof payload?.prompt === 'string' ? payload.prompt.trim() : '',
    rrule: typeof payload?.rrule === 'string' ? payload.rrule.trim() : '',
    status: normalizeThreadAutomationStatus(payload?.status),
  }
}
```

- [ ] **Step 5: Run GREEN native-store test**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/nativeStore.test.ts
```

Expected: PASS.

## Task 2: Bridge Route Delegation

**Files:**
- Modify: `src/server/codexAppServerBridge.ts`
- Test: `src/server/automations/__tests__/nativeStore.test.ts`

- [ ] **Step 1: Import extracted functions**

Add imports near the other local server imports:

```ts
import {
  deleteThreadHeartbeatAutomation,
  listThreadHeartbeatAutomations,
  readThreadHeartbeatAutomation,
  writeThreadHeartbeatAutomation,
} from './automations/nativeStore.js'
import { parseThreadAutomationWritePayload } from './automations/legacyAdapter.js'
```

- [ ] **Step 2: Remove private bridge implementation**

Remove the private bridge-local definitions for:

- `getCodexAutomationsDir`
- `ThreadAutomationStatus`
- `ThreadAutomationRecord`
- `readTomlString`
- `serializeTomlString`
- `parseAutomationToml`
- `serializeAutomationToml`
- `slugifyAutomationId`
- `readAutomationRecordFromFile`
- `listThreadHeartbeatAutomations`
- `readThreadHeartbeatAutomation`
- `writeThreadHeartbeatAutomation`
- `deleteThreadHeartbeatAutomation`

- [ ] **Step 3: Delegate PUT payload parsing**

Replace the current inline payload parsing in the `PUT /codex-api/thread-automation` block with:

```ts
const { threadId, name, prompt, rrule, status } = parseThreadAutomationWritePayload(asRecord(await readJsonBody(req)))
if (!threadId || !name || !prompt || !rrule) {
  setJson(res, 400, { error: 'threadId, name, prompt, and rrule are required' })
  return
}
const automation = await writeThreadHeartbeatAutomation({ threadId, name, prompt, rrule, status })
setJson(res, 200, { data: automation })
return
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/nativeStore.test.ts src/server/codexAppServerBridge.inlinePayload.test.ts
```

Expected: PASS.

## Task 3: Docs, Build, Review, Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
- Modify: `tests.md`

- [ ] **Step 1: Link Phase 2 implementation plan**

Add under Phase 2:

```markdown
Phase 2 implementation plan: [`2026-04-30-automations-phase-2-heartbeat-store-extraction.md`](2026-04-30-automations-phase-2-heartbeat-store-extraction.md).
```

- [ ] **Step 2: Add `tests.md` entry**

Append a section named `Automations Phase 2 heartbeat store extraction` with:

- targeted Vitest command
- `pnpm run build`
- expected legacy endpoint behavior unchanged
- cleanup notes for temporary `$CODEX_HOME`

- [ ] **Step 3: Final verification**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/server/automations/__tests__/nativeStore.test.ts src/server/codexAppServerBridge.inlinePayload.test.ts
pnpm run build
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/server/automations/nativeStore.ts src/server/automations/legacyAdapter.ts src/server/automations/__tests__/nativeStore.test.ts src/server/codexAppServerBridge.ts docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md docs/superpowers/plans/2026-04-30-automations-phase-2-heartbeat-store-extraction.md tests.md
git commit -m "refactor(automations): extract heartbeat native store"
```

Expected: a single Phase 2 commit on `feat/automations`.

## Self-Review

- Spec coverage: includes native store extraction, legacy adapter boundary, route delegation, unit tests, docs, build, and commit.
- Behavior guardrails: no first-class Automations API, scheduler, runner, route mount, or UI route is introduced in this phase.
- Compatibility: legacy status casing and endpoint payload shape remain uppercase and unchanged.
