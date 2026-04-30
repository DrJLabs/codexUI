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
- Automation-run display is separate from definitions: `UiMessage` can carry `isAutomationRun` and `automationDisplayName`.

### Client Gateway

- `src/api/codexGateway.ts` parses thread automation payloads with `asAutomation`.
- `asAutomation` accepts only `heartbeat` and `cron` kinds.
- The client API surface is:
  - `getThreadAutomationMap()`
  - `getThreadAutomation(threadId)`
  - `upsertThreadAutomation(input)`
  - `deleteThreadAutomation(threadId)`
- Gateway calls use `/codex-api/thread-automations` and `/codex-api/thread-automation`.
- The gateway treats a malformed upsert response as an error instead of silently accepting it.

### Sidebar UI

- `src/components/sidebar/SidebarThreadTree.vue` owns the current create/edit/delete dialog.
- The thread menu label switches between `Add automation...` and `Edit automation...`.
- The dialog writes `name`, `prompt`, `rrule`, and uppercase status.
- The thread row shows an automation chip when `automationByThreadId` has an entry for that thread.
- Thread deletion attempts to remove the attached heartbeat automation before removing the local thread state.

### Server Bridge

- `src/server/codexAppServerBridge.ts` stores automations under `getCodexHomeDir()/automations`.
- `parseAutomationToml` reads a narrow top-level key/value subset.
- Required parsed fields are `id`, `name`, `prompt`, and `rrule`.
- Accepted `kind` values are `heartbeat` and `cron`.
- Accepted `status` values are `ACTIVE` and `PAUSED`.
- `serializeAutomationToml` writes `version`, `id`, `kind`, `name`, `prompt`, `status`, `rrule`, `target_thread_id`, `created_at`, and `updated_at`.
- `listThreadHeartbeatAutomations` only returns records with `kind === 'heartbeat'` and a `targetThreadId`.
- `writeThreadHeartbeatAutomation` creates `memory.md` if missing.
- `deleteThreadHeartbeatAutomation` removes the entire automation directory.

### Server Routes

- `GET /codex-api/thread-automations` returns a thread-id keyed map.
- `GET /codex-api/thread-automation?threadId=...` returns one record or `null`.
- `PUT /codex-api/thread-automation` requires `threadId`, `name`, `prompt`, and `rrule`; status defaults to `ACTIVE` unless the payload is exactly `PAUSED`.
- `DELETE /codex-api/thread-automation?threadId=...` removes the native automation directory for the attached heartbeat record.
- These legacy routes currently live inside the generic Codex app-server bridge.

### Manual Test Coverage

- `tests.md` contains a manual test section named `Thread heartbeat automations`.
- The test expects creation under the Codex automations store and attachment by `target_thread_id`.
- Existing manual coverage is UI-flow oriented; Phase 2 should add unit coverage for parser, serializer, and endpoint shape compatibility.

## Live Store Inventory

Command:

```bash
find "${CODEX_HOME:-$HOME/.codex}/automations" -maxdepth 2 -type f -name 'automation.toml' -printf '%p\n' 2>/dev/null | sort
```

Current result: no `automation.toml` files were found on this host.

Implication: the first extraction should rely on synthetic fixtures for compatibility tests, not on host-local records.

If records exist on another host later, inventory only redacted structural facts:

- record count
- relative automation directory names
- key names present
- status values present
- whether `target_thread_id` is present
- whether sidecar files already exist

Do not paste prompts, secrets, or full TOML bodies into repo docs.

## Desktop And Runtime Parity Evidence

Checked local reference root: `/home/drj/.codex/docs/codex/README.md`.

Checked snapshots:

- `/home/drj/.codex/docs/codex/runtime/`
- `/home/drj/.codex/docs/codex/upstream/`
- `/home/drj/.codex/reports/docs-seeker/codex-official-docs/`

Search command:

```bash
rg -n "automation|Automations|heartbeat|TOML|toml" /home/drj/.codex/docs/codex /home/drj/.codex/reports/docs-seeker/codex-official-docs -S
```

Result: current local snapshots contain Codex config TOML references, but no documented automation TOML schema or Desktop Automations storage contract.

Implication: do not add CodexUI metadata to `automation.toml` based on inferred Desktop behavior.

## Migration Decision

Use sidecar-first metadata:

- Native runtime/Desktop-compatible record: `automation.toml`.
- CodexUI metadata record: `codexui.json`.
- Legacy thread endpoints continue to expose uppercase `ACTIVE` and `PAUSED`.
- First-class Automations types can use internal lowercase status only through an explicit adapter.
- Imported heartbeat records keep nullable `projectRoot`, `cwd`, `runMode`, `runProfileId`, `model`, and `reasoningEffort` until explicitly configured.
- `disabled` remains a CodexUI-only state until runtime/Desktop parity proves it is safe in native records.

## Phase 2 Guardrails

- Extract parser/serializer/list/read/write/delete behavior without changing endpoint response shape.
- Add a `legacyAdapter.ts` boundary for case and field translation.
- Preserve or avoid touching unknown TOML fields during sidecar-only metadata operations.
- Do not introduce scheduler or runner behavior in the store-extraction slice.
- Add synthetic fixtures for `ACTIVE`, `PAUSED`, invalid records, and unknown TOML fields.
- Keep destructive directory removal behind the legacy delete operation and make any first-class delete API explicit about folder removal.
