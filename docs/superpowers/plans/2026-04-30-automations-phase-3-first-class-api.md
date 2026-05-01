# Automations Phase 3 First-Class API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `/codex-api/automations` API mounted before the generic Codex bridge, exposing automation definitions without scheduling or executing work.

**Architecture:** Keep native `$CODEX_HOME/automations/*/automation.toml` as the imported heartbeat compatibility boundary. Add a small Automations server module set around the Phase 2 native store: route layer, schema validation, CSRF/trusted-access guard, and service/definition mapping. Persist CodexUI-only metadata in a sidecar file next to native automations so unknown Desktop/runtime TOML fields remain untouched. Mutating routes require trusted access plus Automations CSRF.

**Non-goals:** No scheduler loop, no manual run endpoint, no Kanban projection, no artifact indexing, and no UI route in this phase.

---

## File Structure

- Create: `src/types/automations.ts`
  - Public API types for definitions, state, templates, sources, statuses, schedules, targets, execution fields, and diagnostics.
- Create: `src/server/automations/csrf.ts`
  - Automations CSRF token/header, mirroring the Kanban timing-safe pattern with an Automations-specific header.
- Create: `src/server/automations/remoteAccess.ts`
  - Thin wrapper/re-export over Kanban remote-access classification so Automations does not import Kanban route code.
- Create: `src/server/automations/errors.ts`
  - `AutomationNotFoundError`, `AutomationValidationError`, and HTTP status helper.
- Create: `src/server/automations/schema.ts`
  - Request/query parsing for create, patch, delete options, and route params.
- Create: `src/server/automations/service.ts`
  - Maps native heartbeat records to first-class definitions, reads/writes sidecars, lists invalid diagnostics, and performs create/update/pause/resume/delete.
- Create: `src/server/automations/routes.ts`
  - `createAutomationsRouter()` Express router for `/codex-api/automations`.
- Create: `src/server/automations/index.ts`
  - Middleware export.
- Create: `src/server/automations/__tests__/routes.test.ts`
  - API route coverage.
- Modify: `src/server/automations/nativeStore.ts`
  - Export safe native listing/path helpers needed by the service without weakening Phase 2 behavior.
- Modify: `src/server/httpServer.ts`
  - Mount `/codex-api/automations` before `app.use(bridge)`.
- Modify: `vite.config.ts`
  - Mount `/codex-api/automations` in the dev middleware before the generic bridge, matching the existing Kanban/artifacts dev-server ownership pattern.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Link this implementation plan.
- Modify: `tests.md`
  - Add Phase 3 verification steps.

## API Contract

Routes under `/codex-api/automations`:

- `GET /health`
  - Response: `{ data: { ok: true } }`
- `GET /csrf`
  - Requires trusted access.
  - Response: `{ data: { csrfToken: string, headerName: 'x-codexui-automations-csrf' } }`
- `GET /state`
  - Response: `{ data: AutomationsState }`
  - Includes `storageRoot`, `featureFlags`, `sourceCounts`, `diagnostics`, and current definitions.
- `GET /templates`
  - Response: `{ data: AutomationTemplate[] }`
- `GET /`
  - Response: `{ data: AutomationDefinition[] }`
- `GET /:automationId`
  - Response: `{ data: AutomationDefinition }`
- `POST /`
  - Requires trusted access and CSRF.
  - Creates a thread-attached heartbeat definition only in this phase.
  - Response: `201 { data: AutomationDefinition }`
- `PATCH /:automationId`
  - Requires trusted access and CSRF.
  - Updates editable definition fields without changing scheduler/execution behavior.
  - Response: `{ data: AutomationDefinition }`
- `POST /:automationId/pause`
  - Requires trusted access and CSRF.
  - Response: `{ data: AutomationDefinition }`
- `POST /:automationId/resume`
  - Requires trusted access and CSRF.
  - Response: `{ data: AutomationDefinition }`
- `DELETE /:automationId`
  - Requires trusted access and CSRF.
  - Default: remove CodexUI sidecar metadata only when present; preserve native folder.
  - Explicit destructive removal: `?removeNative=true` or JSON body `{ "removeNative": true }` removes the underlying native automation folder.
  - Response: `{ data: { removed: boolean, removedNative: boolean } }`

## Definition Model

Initial first-class definitions are heartbeat-oriented:

```ts
type AutomationDefinition = {
  id: string
  kind: 'heartbeat'
  source: 'native' | 'codexui'
  nativeId: string | null
  name: string
  description: string | null
  prompt: string
  status: 'active' | 'paused'
  legacyStatus: 'ACTIVE' | 'PAUSED'
  schedule: { type: 'rrule'; rrule: string }
  targetThreadId: string | null
  projectRoot: string | null
  cwd: string | null
  runMode: 'chat' | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
  autoArchiveNoFindings: boolean
  notifyOnFindings: boolean
  kanbanProjection: { mode: 'off' }
  notes: string
  storage: {
    nativeDirName: string | null
    nativePath: string | null
    sidecarPath: string | null
  }
  createdAtIso: string
  updatedAtIso: string
  lastRunAtIso: null
  nextRunAtIso: null
  version: number
}
```

This is the high-level `AutomationDefinition` contract narrowed to Phase 3-supported values. Later phases can expand `kind`, schedules, run modes, projection modes, run timestamps, and version semantics without changing the field names.

Phase 3 must not calculate due times or execute scheduled work. `nextRunAtIso` and `lastRunAtIso` are always `null`; they are placeholders for the scheduler/manual-run phases.

Sidecar file name: `codexui.json`.

Sidecar fields allowed in Phase 3:

- `description`: string or null.
- `cwd`: string or null, must be absolute when present.
- `runProfileId`: string or null.
- `model`: string or null.
- `reasoningEffort`: string or null.
- `notes`: string, trimmed, max 4000 chars.

## Task 1: Types, Schema, And Native Store Helpers

**Files:**
- Create: `src/types/automations.ts`
- Create: `src/server/automations/schema.ts`
- Modify: `src/server/automations/nativeStore.ts`
- Update tests where needed.

- [ ] **Step 1: Write failing tests for API service prerequisites**
  - Add or extend tests to prove:
    - Native entries expose their source directory safely.
    - Invalid TOML diagnostics can be listed without throwing.
    - Valid heartbeat records with `targetThreadId: null` remain visible by automation id in the first-class service/native listing path. The legacy thread map can continue filtering detached records, but the Automations API must not make a detached definition disappear.
    - Request schema rejects empty name/prompt, malformed RRULE, missing thread ID for heartbeat create, relative `cwd`, invalid nullable execution fields, and unsupported execution modes.

- [ ] **Step 2: Implement shared API types**
  - Define `AutomationDefinition`, `AutomationStatus`, `AutomationSchedule`, `AutomationTarget`, `AutomationExecution`, `AutomationStorageInfo`, `AutomationDiagnostic`, `AutomationsState`, and `AutomationTemplate`.
  - Keep type names independent from Kanban.

- [ ] **Step 3: Export native store helpers**
  - Add a public helper that returns native entries with `record`, `sourceDirName`, `automationTomlPath`, `automationDirPath`, and diagnostics for invalid files.
  - Keep mutation functions using safe source-directory behavior from Phase 2.
  - Add a native delete-by-source-dir helper only if the service needs destructive delete by automation id.

- [ ] **Step 4: Implement schema parsing**
  - Parse create, patch, delete options, and route params from unknown input.
  - Validate:
    - `kind` is `heartbeat` for Phase 3 create.
    - `schedule.type` is `rrule`.
    - `rrule` passes the local Phase 3 RRULE subset parser: semicolon-separated `KEY=VALUE` parts, exactly one `FREQ`, `FREQ` in `MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY`, no empty keys/values, no duplicate keys, optional `INTERVAL` as a positive integer, optional comma-list `BYHOUR` values from 0 through 23, optional comma-list `BYMINUTE` values from 0 through 59, and optional comma-list `BYDAY` values in `MO|TU|WE|TH|FR|SA|SU`. Do not add a new dependency for this phase.
    - `targetThreadId` is non-empty for heartbeat create and nullable for patch.
    - `runMode` is `chat` or null.
    - `cwd` is null or absolute.
    - `runProfileId`, `model`, and `reasoningEffort` are null or non-empty strings.
    - Sidecar `notes` is a string no longer than 4000 chars.

## Task 2: Service And Sidecar Persistence

**Files:**
- Create: `src/server/automations/service.ts`
- Update: native store tests or add service tests.

- [ ] **Step 1: Write failing service tests**
  - Listing maps existing native heartbeat automations to lower-case first-class statuses.
  - Patching a definition to `targetThreadId: null` leaves it readable by `GET /codex-api/automations/:automationId` and present in the first-class list.
  - State includes storage root, source counts, feature flags, definitions, and safe invalid diagnostics.
  - Create writes native TOML and sidecar metadata.
  - Patch updates native fields and sidecar fields while preserving unknown TOML fields.
  - Pause/resume update status only.
  - Delete without `removeNative` removes sidecar only and leaves native folder.
  - Delete with `removeNative` removes the native folder.

- [ ] **Step 2: Implement sidecar helpers**
  - Read/write/delete `codexui.json`.
  - Treat malformed sidecar JSON as a safe diagnostic and ignore it for definition mapping.

- [ ] **Step 3: Implement service operations**
  - Use native store for heartbeat persistence.
  - Use sidecar for CodexUI-only execution/notes fields.
  - Resolve automation ids by native record id first and safe source directory second.
  - Return `AutomationNotFoundError` when an id is unknown.

## Task 3: Router, CSRF, Trusted Access, And Mount

**Files:**
- Create: `src/server/automations/csrf.ts`
- Create: `src/server/automations/remoteAccess.ts`
- Create: `src/server/automations/errors.ts`
- Create: `src/server/automations/routes.ts`
- Create: `src/server/automations/index.ts`
- Create: `src/server/automations/__tests__/routes.test.ts`
- Modify: `src/server/httpServer.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write failing route tests**
  - `GET /health`, `/state`, `/templates`, `/`, and `/:id` return data-wrapped responses.
  - `GET /csrf` rejects untrusted forwarded access and returns token/header for loopback.
  - Mutating routes reject missing/invalid CSRF.
  - Mutating routes reject untrusted forwarded access.
  - Create/patch/pause/resume/delete perform expected service behavior.
  - Mount test proves `/codex-api/automations/health` is served by the Automations router, not the generic bridge.

- [ ] **Step 2: Implement CSRF and trusted access guard**
  - Header: `x-codexui-automations-csrf`.
  - Mirror Kanban route posture: trusted local/Tailscale only for CSRF issuance and mutations.

- [ ] **Step 3: Implement router**
  - Use `express.json({ limit: '1mb' })`.
  - Return JSON errors with 400 for validation, 403 for trusted/CSRF failures, 404 for missing ids, and 500 only for unexpected errors.

- [ ] **Step 4: Mount router**
  - In `src/server/httpServer.ts`, create and mount `createAutomationsMiddleware()` at `/codex-api/automations` before `app.use(bridge)`.
  - In `vite.config.ts`, mount the same middleware before `server.middlewares.use(bridge)` so `pnpm run dev` serves `/codex-api/automations/*` through the first-class router.

## Task 4: Documentation And Verification

**Files:**
- Modify: high-level plan.
- Modify: `tests.md`.

- [ ] **Step 1: Link Phase 3 plan**
  - Add a Phase 3 implementation-plan link in the high-level plan.

- [ ] **Step 2: Update tests.md**
  - Add automated verification commands.
  - Add manual API smoke steps.
  - No light/dark theme checks are required because Phase 3 has no UI changes.

- [ ] **Step 3: Final verification**
  - Dependency preflight for this worktree:
    - If `node_modules` is absent or missing required tools/packages such as Vitest, Vue TSC, TSUP, Vite, or Commander, temporarily link `node_modules` to `${HOST_NODE_MODULES}`.
    - Remove the temporary symlink after verification.
  - Run:
    - `pnpm exec vitest run src/server/automations/__tests__/nativeStore.test.ts src/server/automations/__tests__/legacyRoutes.test.ts src/server/automations/__tests__/routes.test.ts`
    - `pnpm run build`
    - `node dist-cli/index.js --help`
    - `git diff --check`
