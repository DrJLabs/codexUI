# CodexUI Desktop-Parity Implementation Plan

> For agentic workers: use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Keep each implementation slice narrow, update `tests.md`, and follow the repo-local dev-to-upstream workflow.

Date: 2026-04-29
Plan branch: `plan/desktop-parity-implementation-dev`
Plan worktree: `$HOME/projects/codexUI-desktop-parity-plan-dev`
Base branch: local `dev`
Base SHA: `873ef780670063f29438ead5403bf057ff7c20d0`
Source plan reviewed: `/tmp/codex-web-uploads/f-qFiCcr/pasted-text-2026-04-29-05-39-45.txt`

## Executive Direction

CodexUI should keep its browser, mobile, LAN, Tailscale, and headless value proposition while moving toward desktop-app parity through shared workspace primitives.

Kanban remains useful, but it must become an orchestration view over shared CodexUI primitives, not the owner of execution policy, run settings, evidence, review packets, proposal handling, artifact previews, or worktree lifecycle.

The implementation direction is:

```text
Thread workspace and shared artifacts are the product core.
Kanban is one view that can create and consume those artifacts.
Execution is explicit, auditable, profile-based, and never self-merging.
Remote/mobile execution is supported only when intentionally enabled and visible.
```

## What Changed From The Pasted Master Plan

### 1. Branch context changed

The pasted plan says the primary branch context is `feature/kanban-board-dev` and later says to merge that branch after corrections. Repo reality has moved on:

- local `dev` is already at `873ef78`, a merge commit from `feature/kanban-board-dev`.
- the Kanban files already exist under `src/server/kanban`, `src/components/kanban`, `src/api/kanbanGateway.ts`, `src/composables/useKanbanBoard.ts`, and `src/types/kanban.ts`.
- completion docs already exist at `docs/superpowers/reports/2026-04-29-kanban-parity-completion-report.md`.

Therefore this plan removes the "merge current Kanban foundation" phase and treats local `dev` as the foundation.

### 2. Execution policy is not hypothetical

The pasted plan proposes a new model from scratch. Current repo reality already has:

- `KanbanExecutionPolicy` in `src/types/kanban.ts`
- environment-gated execution in `src/server/kanban/config.ts`
- trusted loopback/Tailscale classification in `src/server/kanban/remoteAccess.ts`
- CSRF gating in `src/server/kanban/routes.ts`
- hash-chain audit logs in `src/server/kanban/auditLog.ts`
- hardcoded runner settings in `src/server/kanban/codexKanbanRunner.ts`

So the first implementation slice should migrate the existing policy safely instead of replacing it wholesale.

### 3. The run-profile API was made conservative

The pasted plan uses `permissionProfile` as if it is a current app-server contract. The local Codex reference snapshot is `codex-cli 0.122.0`; the saved runtime/config docs clearly expose `sandbox_mode`, `approval_policy`, `sandbox_workspace_write.network_access`, and `sandbox_workspace_write.writable_roots`. This repo currently sends camelCase `sandboxMode`, `approvalPolicy`, and `networkAccess` to `turn/start`.

Because the app-server turn schema is not proven in this plan branch, implementation must not hardcode a `permissionProfile` contract yet. The run-profile slice should first generate or inspect the current app-server schema, then map profiles to the actual accepted payload. Until proven otherwise, use the repo's existing `sandboxMode` / `approvalPolicy` / `networkAccess` shape and keep any future `permissions` or `default_permissions` support behind an adapter.

### 4. Codex.app parity evidence is a gate, not assumed evidence

This Linux host does not have `/Applications/Codex.app`, so live Codex.app CDP inspection cannot run here. The implementation plan keeps a parity evidence gate for UI/behavior work:

- on a macOS host with Codex.app, inspect `app.asar` and capture CDP reference screenshots before implementing UI parity;
- on this host, use the skill fallback explicitly and rely on existing repo behavior plus saved local Codex reference docs.

### 5. Shared artifact extraction must follow existing shell structure

The pasted plan invents many neutral files up front. The current UI is centered in `src/App.vue`, with `ReviewPane`, `ThreadConversation`, `ThreadTerminalPanel`, and `KanbanBoardPage` rendered inside the existing content shell. The extraction should be incremental:

- introduce shared types only when the first consumer needs them;
- avoid a broad `src/types/*` dump before behavior exists;
- keep `ReviewPane.vue` the canonical diff viewer;
- add thread artifact UI as a focused shell next to the current thread conversation, not as a replacement for the main app shell.

## Current Repo Truth

Relevant files already present:

- `src/types/kanban.ts`: task, board, run, review packet, proposal, and execution policy DTOs.
- `src/server/kanban/config.ts`: default policy, currently `executionEnabled` only when `CODEXUI_KANBAN_EXECUTION_ENABLED=1`.
- `src/server/kanban/remoteAccess.ts`: loopback and Tailscale/Tailscale Serve classification.
- `src/server/kanban/routes.ts`: `/codex-api/kanban/*`, CSRF, execution start/interrupt/complete, review approval, proposal routes.
- `src/server/kanban/codexKanbanRunner.ts`: managed worktree run lifecycle, `thread/start`, `thread/resume`, `turn/start`, completion capture, proposal parsing, review packet generation.
- `src/server/kanban/worktreeManager.ts`: Kanban-managed worktree creation and cleanup.
- `src/server/kanban/reviewPacketService.ts`: Kanban review packet generation.
- `src/server/kanban/proposalService.ts`: inert Kanban proposal handling.
- `src/components/kanban/*`: board, config, inspector, run controls, logs, review packet, proposal inbox.
- `src/App.vue`: route shell and current thread/review/terminal composition.
- `src/components/content/ReviewPane.vue`: existing canonical diff/review viewer.
- `tests.md`: existing manual verification log, including Kanban entries.

Current important constraints:

- Kanban execution is disabled by default unless `CODEXUI_KANBAN_EXECUTION_ENABLED=1`.
- Existing trusted access is local/Tailscale-oriented, not a general auth model.
- Board mutations already use CSRF.
- Runs are one-active-run limited through `KanbanTaskQueue`.
- The runner currently hardcodes `workspace-write`, `on-request`, and `networkAccess: false`.
- No current shared artifact sidebar exists outside Kanban.

## Non-Negotiable Invariants

- No auto-merge to `main`.
- No auto-push to `main`.
- No force-push shared branches.
- No agent self-approval.
- No agent-created task starts automatically.
- No hidden privilege escalation between run profiles.
- No arbitrary local file preview by path parameter.
- No dirty worktree deletion without explicit confirmation.
- Review approval must require a current review packet and unresolved proposal check.
- Remote/mobile execution must be visible, intentional, CSRF-protected, and audited.

## Phase 0: Parity Evidence And Schema Baseline

Goal: establish the evidence gates before changing behavior.

Files:

- Create: `docs/superpowers/reports/2026-04-29-desktop-parity-baseline.md`
- Optional helper: `scripts/inspect-codex-app-parity.mjs`

Tasks:

- Record that `/Applications/Codex.app` is absent on this host.
- Record the local Codex reference snapshot: `$HOME/.codex/docs/codex/README.md`, installed `codex-cli 0.122.0`.
- Generate or inspect the current app-server schema for `turn/start`, approval requests, and any per-turn config override fields.
- Document the accepted run-setting payload used by this repo: current camelCase fields versus schema-native config keys.
- Decide whether `permissionProfile` is a real current app-server field. If not proven, do not implement it.

Acceptance criteria:

- The report states exactly what Codex.app parity evidence is available and unavailable.
- The run-profile implementation has a verified payload target before code changes.
- No UI or behavior changes land in this phase.

Verification:

```bash
test -e /Applications/Codex.app; echo $?
sed -n '1,120p' $HOME/.codex/docs/codex/README.md
rg -n "sandbox_mode|approval_policy|network_access|writable_roots|permission" $HOME/.codex/docs/codex
```

## Phase 1: Execution Modes Over Existing Policy

Goal: replace the flat `KanbanExecutionPolicy` booleans with explicit, UI-visible execution modes while preserving current defaults and tests.

Branch:

```text
feature/desktop-parity-execution-modes-dev
```

Files:

- Modify: `src/types/kanban.ts`
- Modify: `src/server/kanban/config.ts`
- Modify: `src/server/kanban/remoteAccess.ts`
- Modify: `src/server/kanban/routes.ts`
- Modify: `src/server/kanban/schema.ts`
- Modify: `src/server/kanban/migrations.ts`
- Modify: `src/components/kanban/KanbanBoardPage.vue`
- Modify: `src/components/kanban/KanbanConfigPanel.vue`
- Modify: `src/components/kanban/TaskRunControls.vue`
- Tests: `src/server/kanban/__tests__/config.test.ts`
- Tests: `src/server/kanban/__tests__/remoteAccess.test.ts`
- Tests: `src/server/kanban/__tests__/policy.test.ts`
- Tests: `src/server/kanban/__tests__/routes.test.ts`
- Tests: `src/composables/useKanbanBoard.test.ts`
- Docs: `tests.md`

Implementation notes:

- Add a `KanbanExecutionMode` union:

```ts
type KanbanExecutionMode = 'disabled' | 'local_only' | 'trusted_remote' | 'open_remote'
```

- Replace the single `trusted` meaning with request capabilities derived from `KanbanRemoteAccess`:

```ts
type KanbanRequestCapabilities = {
  accessContext: 'loopback' | 'tailscale' | 'lan' | 'tunnel' | 'reverse_proxy' | 'public' | 'unknown'
  trustedForRead: boolean
  trustedForBoardMutation: boolean
  trustedForExecution: boolean
  trustedForExecutionApproval: boolean
  trustedForSecrets: boolean
  trustedForCleanup: boolean
  trustedForMerge: false
}
```

- Keep the existing Tailscale detection, but rename outputs in UI and audit events from generic `trusted` toward capability-specific language.
- Default mode must remain effectively disabled unless execution is intentionally enabled.
- `trusted_remote` should allow loopback and Tailscale by default, because the current implementation already supports Tailscale as a trusted access class.
- `open_remote` must not be enabled until a real authenticated remote-user model exists. It can be represented in types and settings as unavailable/advanced, but route behavior should reject it unless auth is implemented.
- Board mutation and execution mutation should stay separate. Board edits can remain CSRF-protected; run start/approval should evaluate execution capabilities.
- Persist mode in board config/settings, not only environment policy, so the UI can display and change it.

Acceptance criteria:

- Disabled mode blocks run start.
- Local-only allows loopback and blocks Tailscale.
- Trusted remote allows loopback and configured Tailscale.
- Untrusted forwarded headers still fail.
- The Kanban page banner shows the current mode and current access context.
- The run button tooltip explains the blocking reason from the mode/capability result.
- Audit events include `executionMode` and `accessContext`.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/config.test.ts src/server/kanban/__tests__/remoteAccess.test.ts src/server/kanban/__tests__/policy.test.ts src/server/kanban/__tests__/routes.test.ts
pnpm vitest run src/composables/useKanbanBoard.test.ts
pnpm run build
```

Manual `tests.md` update:

- Add light-theme and dark-theme checks for the execution-mode banner.
- Include loopback and Tailscale header checks.
- Include rollback notes for test Kanban data under `${CODEX_HOME:-$HOME/.codex}/codexui-kanban/`.

## Phase 2: Codex Run Profiles

Goal: replace hardcoded runner settings with named run profiles that map to verified Codex app-server payloads.

Branch:

```text
feature/desktop-parity-run-profiles-dev
```

Files:

- Modify: `src/types/kanban.ts`
- Modify: `src/server/kanban/config.ts`
- Modify: `src/server/kanban/schema.ts`
- Modify: `src/server/kanban/migrations.ts`
- Modify: `src/server/kanban/codexKanbanRunner.ts`
- Modify: `src/server/kanban/routes.ts`
- Modify: `src/components/kanban/KanbanConfigPanel.vue`
- Modify: `src/components/kanban/TaskRunControls.vue`
- Modify: `src/components/kanban/KanbanTaskInspector.vue`
- Tests: `src/server/kanban/__tests__/config.test.ts`
- Tests: `src/server/kanban/__tests__/codexKanbanRunner.test.ts`
- Tests: `src/server/kanban/__tests__/routes.test.ts`
- Tests: `src/composables/useKanbanBoard.test.ts`
- Docs: `tests.md`

Conservative type target:

```ts
type CodexRunProfile = {
  id: string
  name: string
  description: string
  model: string
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | ''
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'untrusted' | 'on-request' | 'never'
  networkAccess: boolean
  writableRoots: string[]
  createdAtIso: string
  updatedAtIso: string
}
```

Implementation notes:

- Keep `approvalPolicy: 'never'` and `sandboxMode: 'danger-full-access'` behind explicit high-friction selection and execution-mode checks.
- Do not send both old and new config shapes if Phase 0 proves a newer app-server profile field exists.
- Keep a single adapter function:

```ts
resolveCodexTurnStartRunSettings(profile, schemaCapabilities)
```

- Store:
  - board default profile ID in `KanbanBoardConfig`
  - optional task profile ID / overrides on `KanbanTask`
  - effective profile snapshot on `KanbanRun`
- Pre-run UI must show the effective profile, network setting, writable roots, approval policy, and merge invariant.

Built-in profiles:

- Read-only planning: `read-only`, `on-request`, network off.
- Workspace coding: `workspace-write`, `on-request`, network off.
- Workspace coding + network: `workspace-write`, `on-request`, network on.
- Full-access operator: `danger-full-access`, `on-request`, network on, explicit warning.
- Custom: exact user-defined settings after validation.

Acceptance criteria:

- Existing hardcoded `workspace-write/on-request/network false` behavior becomes the default profile.
- Task overrides beat board defaults.
- Effective profile is audited on `run.queued` and `run.started`.
- The runner uses the adapter output, not direct hardcoded fields.
- Full-access cannot be selected accidentally and never implies auto-merge.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/config.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/kanban/__tests__/routes.test.ts
pnpm vitest run src/composables/useKanbanBoard.test.ts
pnpm run build
```

## Phase 3: Shared Workspace Artifact Contracts

Goal: extract neutral contracts from Kanban only where an immediate thread or Kanban consumer exists.

Branch:

```text
feature/desktop-parity-artifact-contracts-dev
```

Files:

- Create: `src/types/workspaceArtifacts.ts`
- Create: `src/server/artifacts/artifactIndex.ts`
- Create: `src/server/artifacts/adapters/kanbanArtifacts.ts`
- Modify: `src/server/kanban/reviewPacketService.ts`
- Modify: `src/server/kanban/codexKanbanRunner.ts`
- Tests: `src/server/kanban/__tests__/reviewPacketService.test.ts`
- Add tests for new artifact index service.
- Docs: `tests.md`

Contract scope:

```ts
type WorkspaceArtifact =
  | { kind: 'plan'; source: 'thread' | 'kanban'; threadId?: string; taskId?: string }
  | { kind: 'run_metadata'; runId: string; taskId?: string; threadId?: string }
  | { kind: 'evidence'; runId?: string; threadId?: string }
  | { kind: 'review_packet'; packetId: string; taskId?: string; threadId?: string }
  | { kind: 'proposal'; proposalId: string; taskId?: string; threadId?: string }
  | { kind: 'worktree'; worktreePath: string; runId?: string; taskId?: string }
```

Implementation notes:

- Shared artifact contracts must not import Vue components.
- Shared contracts must not import Kanban services directly.
- Kanban adapters can import Kanban types.
- Do not create arbitrary file-preview routes in this phase.
- Do not duplicate `ReviewPane` diff rendering.

Acceptance criteria:

- Kanban run/review/proposal data can be exposed through neutral artifact descriptors.
- Existing Kanban UI still works.
- No thread UI change is required yet.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/reviewPacketService.test.ts
pnpm run build
```

## Phase 4: Thread Artifact Sidebar Shell

Goal: add a desktop-parity artifact surface for normal threads without making it a Kanban route.

Branch:

```text
feature/desktop-parity-thread-artifacts-dev
```

Files:

- Create: `src/components/artifacts/ThreadArtifactSidebar.vue`
- Create: `src/components/artifacts/ArtifactTabs.vue`
- Create: `src/components/artifacts/ArtifactEmptyState.vue`
- Create: `src/components/artifacts/RunProfileSummaryCard.vue`
- Create: `src/composables/useThreadArtifacts.ts`
- Modify: `src/App.vue`
- Modify: `src/style.css` only if full-route dark/mobile behavior needs global selectors.
- Tests: add focused composable/unit tests if extraction has logic.
- Docs: `tests.md`

Implementation notes:

- Place the artifact sidebar in the existing thread content shell in `src/App.vue`.
- On mobile, use drawer/sheet behavior consistent with existing mobile layout.
- Initial tabs should be minimal:
  - Plan
  - Run
  - Evidence
  - Review
- Empty states should be terse and operational.
- Keep `ReviewPane.vue` as the full diff viewer. The artifact sidebar can link/open it but should not implement a second diff viewer.

Acceptance criteria:

- A normal thread can show an artifact sidebar independent of `#/kanban`.
- The sidebar can show an empty state when no artifacts exist.
- Kanban does not become a dependency of the thread route.
- Light and dark theme are both readable.

Verification:

```bash
pnpm run build
```

Manual `tests.md` update:

- Add light-theme and dark-theme checks for normal thread artifact sidebar.
- Add mobile checks at 375x812 and 768x1024 if Playwright is requested.

## Phase 5: Evidence And Run Logs As Shared UI

Goal: move command/run evidence display toward shared components while keeping Kanban run logs working.

Branch:

```text
feature/desktop-parity-evidence-dev
```

Files:

- Create: `src/components/artifacts/evidence/ArtifactEvidencePanel.vue`
- Create: `src/components/artifacts/evidence/CommandEvidenceCard.vue`
- Create: `src/components/artifacts/evidence/TestEvidenceCard.vue`
- Create: `src/types/evidence.ts`
- Create: `src/composables/useArtifactEvidence.ts`
- Modify: `src/components/kanban/TaskRunLogPanel.vue`
- Modify: `src/server/kanban/codexKanbanRunner.ts` if event shape needs small additions.
- Tests: runner/event tests where event shape changes.
- Docs: `tests.md`

Evidence should include:

- command started/completed
- stdout/stderr summary
- exit code
- duration
- approval request
- network-enabled marker
- run profile snapshot
- access context
- errors and recovery notes

Acceptance criteria:

- Kanban task detail and thread artifact sidebar use the same evidence component for run facts.
- Long logs are truncated but copyable.
- Audit-relevant facts are visible without exposing secrets.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/kanban/__tests__/auditLog.test.ts
pnpm run build
```

## Phase 6: Shared Review Packet Summary

Goal: make review packets visible outside Kanban while preserving the current review safety checks.

Branch:

```text
feature/desktop-parity-review-packets-dev
```

Files:

- Create: `src/components/artifacts/review/ArtifactReviewPacketPanel.vue`
- Create: `src/components/artifacts/review/ReviewPacketSummaryCard.vue`
- Create: `src/server/reviewPackets/freshness.ts`
- Modify: `src/server/kanban/reviewPacketService.ts`
- Modify: `src/components/kanban/TaskReviewPacketPanel.vue`
- Tests: `src/server/kanban/__tests__/reviewPacketService.test.ts`
- Docs: `tests.md`

Freshness invalidation should consider:

- head commit changed
- raw diff changed
- test results changed
- unresolved proposal set changed
- worktree path missing
- effective run profile changed after run

Acceptance criteria:

- Kanban approval still requires a current packet and blocks unresolved proposals.
- Thread artifact sidebar can summarize a review packet.
- Full diff remains in `ReviewPane.vue`.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/reviewPacketService.test.ts src/server/kanban/__tests__/routes.test.ts
pnpm run build
```

## Phase 7: Shared Proposal Surface

Goal: show and manage proposals outside Kanban without allowing proposals to execute themselves.

Branch:

```text
feature/desktop-parity-proposals-dev
```

Files:

- Create: `src/types/proposal.ts`
- Create: `src/components/artifacts/proposals/ArtifactProposalsPanel.vue`
- Create: `src/components/artifacts/proposals/ProposalCard.vue`
- Create: `src/server/proposals/adapters/kanbanProposals.ts`
- Modify: `src/components/kanban/TaskProposalList.vue`
- Modify: `src/components/kanban/KanbanProposalInbox.vue`
- Tests: `src/server/kanban/__tests__/proposalService.test.ts`
- Tests: `src/server/kanban/__tests__/markerParser.test.ts`
- Docs: `tests.md`

Rules:

- Agent-created proposals are inert.
- Human promotion is required before execution.
- Marker count and byte caps remain enforced.
- Auto proposal policy must be confirm-first by default and cannot start execution.

Acceptance criteria:

- Kanban proposal inbox still works.
- Thread artifact sidebar can show unresolved proposals.
- No proposal starts a run.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/markerParser.test.ts src/server/kanban/__tests__/proposalService.test.ts src/server/kanban/__tests__/routes.test.ts
pnpm run build
```

## Phase 8: Indexed Artifact Previews

Goal: add safe generated-file previews without arbitrary path reads.

Branch:

```text
feature/desktop-parity-artifact-previews-dev
```

Files:

- Create: `src/server/artifacts/routes.ts`
- Create: `src/server/artifacts/security.ts`
- Create: `src/components/artifacts/previews/ArtifactPreviewPanel.vue`
- Modify: server mounting in `src/server/httpServer.ts` and `vite.config.ts` if needed.
- Tests: artifact route/security tests.
- Docs: `tests.md`

Routes:

```text
GET /codex-api/artifacts/:artifactId
GET /codex-api/artifacts/:artifactId/preview
GET /codex-api/artifacts/:artifactId/download
GET /codex-api/artifacts/:artifactId/raw
```

Rules:

- No arbitrary `path=` parameter.
- Only indexed artifacts can be read.
- Sensitive globs are blocked.
- Preview access is audited.
- Remote/mobile access respects the same auth/CSRF/read policy.

Acceptance criteria:

- Indexed text and image previews work.
- Sensitive files are blocked.
- Missing/stale artifact state is visible.
- No route can read an arbitrary local path.

Verification:

```bash
pnpm vitest run <artifact route/security tests>
pnpm run build
```

## Phase 9: Worktree Lifecycle As Shared Primitive

Goal: promote worktree lifecycle out of Kanban-only ownership.

Branch:

```text
feature/desktop-parity-worktrees-dev
```

Files:

- Create: `src/types/worktree.ts`
- Create: `src/server/workspaces/worktreeService.ts`
- Create: `src/components/artifacts/worktree/WorktreeStatusPanel.vue`
- Create: `src/components/artifacts/worktree/WorktreeListPanel.vue`
- Modify: `src/server/kanban/worktreeManager.ts` to delegate or adapt.
- Tests: existing worktree manager tests plus new service tests.
- Docs: `tests.md`

Features:

- list managed worktrees
- show repo, base, branch, path, dirty/missing/stale status
- cleanup clean managed worktree with confirmation
- preserve dirty work
- show recovery actions

Acceptance criteria:

- Worktree status is visible outside Kanban.
- Dirty deletion requires typed confirmation.
- Kanban runner behavior does not regress.

Verification:

```bash
pnpm vitest run src/server/kanban/__tests__/worktreeManager.test.ts src/server/kanban/__tests__/recoveryService.test.ts
pnpm run build
```

## Phase 10: Local Actions And Automations

Goal: add desktop-style local project actions that use the same execution-mode and run-profile model.

Branch:

```text
feature/desktop-parity-local-actions-dev
```

Files:

- Create: `src/types/localActions.ts`
- Create: `src/server/actions/actionRegistry.ts`
- Create: `src/components/actions/ProjectActionsMenu.vue`
- Create: `src/components/artifacts/actions/ActionRunEvidencePanel.vue`
- Tests: action registry and policy tests.
- Docs: `tests.md`

Rules:

- Actions use execution mode and run profile checks.
- Action output becomes evidence.
- No action can merge or push without separate explicit confirmation.
- Mobile trusted remote mode can run actions only when enabled.

Acceptance criteria:

- User can run configured build/test/dev commands.
- Evidence appears in the artifact sidebar.
- Policy behavior is shared with Kanban.

Verification:

```bash
pnpm vitest run <action registry/policy tests>
pnpm run build
```

## Test Strategy

For every implementation branch:

- Run focused Vitest files for changed modules.
- Run `pnpm run build`.
- Update `tests.md`.
- For UI changes, manually verify light and dark theme unless Playwright is explicitly requested.
- If module loading behavior changes, run the repo-required CJS smoke test against the closest public CJS entry.

For Playwright when explicitly requested:

- Use `http://127.0.0.1:4173` unless validating A1/Tailscale behavior.
- Capture light and dark screenshots under `output/playwright/`.
- For responsive work, verify 375x812 and 768x1024.

## Immediate Next Slice

Implement Phase 0 first as a baseline report, then Phase 1.

Do not start shared artifact-sidebar work until execution modes and run profiles are stable. Otherwise every later artifact panel will need to rediscover policy and run-setting semantics.

## Final Position

The pasted plan's product direction is correct: CodexUI should support mobile and trusted-remote execution intentionally rather than hiding execution behind loopback-only assumptions.

The sequencing needed adjustment because the repo already contains the merged Kanban foundation. The next real work is to stabilize and name the existing execution/trust model, verify the app-server run-setting contract, then extract shared desktop-parity primitives incrementally from the working Kanban implementation.
