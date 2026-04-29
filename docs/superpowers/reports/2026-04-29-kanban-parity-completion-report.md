# Kanban Parity Completion Report

Date: 2026-04-29
Branch: `feature/kanban-board-dev`
Worktree: `/home/drj/projects/codexUI-kanban-board-dev`

## Summary

This implementation brings the CodexUI Kanban board to rough functional parity with the reference board while keeping the workflow Codex-specific. The completed feature set includes versioned task APIs, server-side filtering, metadata editing, configurable columns, WIP limits, native drag reorder, proposal marker parsing, run completion capture, review packet generation, and a proposal inbox.

## Commits Included

- `a105e58` `feat: expand kanban state for parity metadata`
- `5c617dc` `feat: add kanban parity api services`
- `1bf86ae` `feat: wire kanban client to parity api`
- `317f83b` `fix: refresh kanban client derived state`
- `93a12ca` `fix: clear kanban stale load state`
- `ccbdfcb` `feat: add kanban metadata and filters`
- `0cd36fd` `fix: tighten kanban metadata filters`
- `a88f6a2` `fix: preserve kanban thread assignees`
- `fcc2ba1` `feat: add kanban config and reorder ui`
- `17a4577` `fix: stabilize kanban reorder config ui`
- `3c5e250` `feat: add kanban marker proposals`
- `66e92f1` `fix: harden kanban proposal resolution`
- `96339e6` `feat: complete kanban runs from codex output`
- `46c2618` `fix: harden kanban run completion`
- `6747236` `fix: handle kanban completion edge cases`
- `6d343a2` `fix: clear failed run review packet`
- `e716a07` `feat: add kanban proposal inbox`
- `b665cb3` `fix: stabilize kanban proposal inbox`
- `13b4c21` `docs: add codex kanban agent reference`

## Endpoints Added Or Expanded

- `GET /codex-api/kanban/tasks`
- `GET /codex-api/kanban/tasks/:taskId`
- `POST /codex-api/kanban/tasks`
- `PATCH /codex-api/kanban/tasks/:taskId`
- `DELETE /codex-api/kanban/tasks/:taskId`
- `POST /codex-api/kanban/tasks/:taskId/status`
- `POST /codex-api/kanban/tasks/:taskId/reorder`
- `GET /codex-api/kanban/config`
- `PUT /codex-api/kanban/config`
- `POST /codex-api/kanban/runs/:runId/complete`
- `GET /codex-api/kanban/proposals?status=`
- `POST /codex-api/kanban/proposals`
- `POST /codex-api/kanban/proposals/:proposalId/approve`
- `POST /codex-api/kanban/proposals/:proposalId/reject`
- Compatibility alias: `POST /codex-api/kanban/proposals/:proposalId/accept`

## Codex-Specific Behavior

- Assignees are `operator`, `codex:auto`, or `codex:thread:<threadId>`.
- Runs use managed worktrees and a constrained Codex bridge.
- Execution remains guarded by trusted local or Tailscale access plus CSRF.
- Completion captures the final Codex turn output through `thread/read`.
- Fenced `kanban:create` and `kanban:update` markers become proposals.
- Successful completion stores clean result text, creates proposals, moves the task to `review`, and generates a review packet.

## Intentional Differences From The Reference Board

- CodexUI keeps its existing statuses: `backlog`, `ready`, `running`, `review`, `rework`, `done`, `cancelled`.
- There are no foreign agent/session concepts; task ownership is expressed with Codex actors.
- CodexUI does not auto merge, push, open pull requests, or delete dirty worktrees.
- Proposal approval is explicit by default. Auto-approval is controlled by board `proposalPolicy`.
- The board is backed by the CodexUI Express API and JSON state under `${CODEX_HOME:-$HOME/.codex}/codexui-kanban`.

## Verification

Automated verification:

```text
pnpm run test:unit
20 test files passed, 138 tests passed.

pnpm run build
Frontend build passed.
CLI build passed.

git diff --check
No whitespace errors.
```

Focused checks run during implementation:

```text
pnpm vitest run src/composables/useKanbanBoard.test.ts
28 tests passed.

pnpm vitest run src/server/kanban/__tests__/codexBridgeAdapter.test.ts src/server/kanban/__tests__/codexKanbanRunner.test.ts src/server/kanban/__tests__/policy.test.ts
23 tests passed.
```

Host-side dev server smoke:

```text
CODEXUI_KANBAN_EXECUTION_ENABLED=1 pnpm run dev -- --host 0.0.0.0 --port 5173
Server started from this worktree on port 5173.

curl -sS http://127.0.0.1:5173/codex-api/kanban/health
{"data":{"ok":true}}

curl -sS -i -H 'x-forwarded-for: 100.100.100.100' http://127.0.0.1:5173/codex-api/kanban/csrf
HTTP/1.1 200 OK

curl -sS -i -H 'x-forwarded-for: 203.0.113.10' http://127.0.0.1:5173/codex-api/kanban/csrf
HTTP/1.1 403 Forbidden

curl -sS http://100.107.239.103:5173/codex-api/kanban/health
{"data":{"ok":true}}

curl -sS -I -H 'Host: codexui-dev.tail7570d1.ts.net' http://127.0.0.1:5173/
HTTP/1.1 200 OK
```

Manual phone result:

- Host-side Tailscale and allowed-host checks passed.
- Physical phone UI verification was not performed from this session.
- Manual light/dark and phone checks remain documented in `tests.md`.

## Remaining Gaps

- No Playwright/browser visual pass was run because browser automation was not explicitly requested.
- Physical phone verification over Tailscale Serve still needs operator confirmation.
- Production hardening beyond the local JSON state model is out of scope for this parity pass.
- The feature branch is not pushed by this report commit.
