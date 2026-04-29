# Kanban Board Parity: CodexUI vs Nerve

Date: 2026-04-28

## Scope

This report compares the CodexUI Kanban board implemented on `feature/kanban-board-dev` with the Kanban board in `/home/drj/nerve`.

Primary CodexUI references:

- `src/types/kanban.ts`
- `src/server/kanban/routes.ts`
- `src/server/kanban/taskService.ts`
- `src/server/kanban/codexKanbanRunner.ts`
- `src/server/kanban/reviewPacketService.ts`
- `src/server/kanban/proposalService.ts`
- `src/composables/useKanbanBoard.ts`
- `src/components/kanban/*`

Primary Nerve references:

- `/home/drj/nerve/server/routes/kanban.ts`
- `/home/drj/nerve/server/lib/kanban-store.ts`
- `/home/drj/nerve/src/features/kanban/*`
- `/home/drj/nerve/skills/nerve-kanban/references/api.md`

## Executive Summary

CodexUI now has a functional Kanban board with task creation, status movement, acceptance criteria, labels, run execution through Codex, managed worktrees, run logs/events, review packets, proposals, rework/approve/reject actions, archival, CSRF protection, loopback-only execution, and audit logging.

Nerve's board is still broader as a multi-agent workflow system. It has configurable columns, WIP limits, task priorities, assignees, model/thinking settings, due/estimate fields, CAS-versioned updates, server-side filtering and pagination, drag/reorder support, proposal creation/update payloads, marker parsing, proposal policy modes, gateway subagent spawning, completion polling, result capture, and explicit task completion webhooks.

The closest parity statement is:

- CodexUI is ahead on local execution safety, managed git worktrees, review-packet generation, run evidence, and audit controls.
- Nerve is ahead on board configurability, task metadata, direct agent collaboration semantics, proposal lifecycle depth, reorder support, and mature execution completion capture.
- CodexUI is implementation-ready for guarded local Codex task execution, but it is not yet a full feature-equivalent clone of Nerve's operational Kanban system.

## Parity Matrix

| Area | CodexUI | Nerve | Parity |
|---|---|---|---|
| Board access | Vue route exposed from the CodexUI menu; state is loaded from `/codex-api/kanban/state`. | React feature under `src/features/kanban`, with task panel, quick view, detail drawer, and proposal inbox. | Partial |
| Default statuses | Fixed statuses: `backlog`, `ready`, `running`, `review`, `rework`, `done`, `cancelled`. | Default lifecycle: `backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled`; custom columns supported through config. | Partial |
| Status workflow | Validated transitions in `KanbanTaskService`, including explicit `rework`. | Store-level transition validation with review-required behavior and done-drag bypass config. | Partial |
| Task creation | Title, description, object labels, first-class acceptance criteria. | Title, description, status, priority, creator, source session, assignee, string labels, model/thinking, due/estimate fields. | Partial |
| Task update | Basic patch for title, description, labels, blocked reason; no client CAS requirement. | CAS-versioned patch with `version` required and conflict response containing latest task. | Missing Nerve parity |
| Task deletion/archive | Archive endpoint only. | Delete endpoint plus task update flows. | Partial |
| Server-side list/search | Snapshot endpoint returns full board state; filtering/search are client-side. | `GET /api/kanban/tasks` supports status, priority, assignee, label, text search, limit, and offset. | Missing Nerve parity |
| Reorder/drag | No drag/reorder endpoint; status changes are command-based. | `POST /api/kanban/tasks/:id/reorder`, `columnOrder`, drag/drop UI. | Missing Nerve parity |
| Board config | Static board definition and execution policy in code. | File-backed config served by `/api/kanban/config`, including columns, WIP limits, defaults, review policy, proposal policy, default model/thinking. | Missing Nerve parity |
| Persistence | Per-project state file under CodexUI's Kanban data directory, atomic writes, corrupt-state backup. | `${NERVE_DATA_DIR:-~/.nerve}/kanban/tasks.json`, atomic writes, migration from legacy paths. | Rough parity |
| Proposals | Pending/accepted/rejected proposals with title/description; accepting creates a new task. | Create/update proposals with payload validation, source session, proposedBy, version, resolution metadata, approve/reject endpoints, proposal inbox. | Partial |
| Agent marker ingestion | Not implemented. | Parses `[kanban:create]` / `[kanban:update]` style markers, strips markers from result text, creates proposals from agent output. | Missing Nerve parity |
| Agent assignment | No assignee model; execution starts a Codex turn for the task. | Task assignee can point to operator or agent, including live root-session targeting for fallback subagent launch. | Missing Nerve parity |
| Execution start | `/tasks/:taskId/run` creates a managed worktree and starts or resumes a Codex thread through the bridge. | `/tasks/:id/execute` spawns a gateway session or fallback child session, links run metadata, and starts completion polling. | Different model |
| Execution safety | Requires execution feature flag, loopback mutation checks, CSRF token, one active run globally/repo/task, safe Codex sandbox/approval/network policy, command-risk audit. | Uses Nerve's route rate limiter and gateway preflights; inspected Kanban routes do not expose equivalent CSRF/loopback/worktree controls. | CodexUI ahead |
| Execution completion | Runner records lifecycle state and exposes run logs/events; review packet can be generated manually or through review actions. | Polls child sessions and has explicit `/complete` webhook; stores result/resultAt/error and moves workflow forward. | Missing Nerve parity |
| Interrupt/abort | `/runs/:runId/interrupt` interrupts Codex turn and marks cancelled. | `/tasks/:id/abort` aborts running task and records feedback. | Rough parity |
| Review workflow | Review packets hash diff/test evidence; approve moves to done, reject/rework can return work to rework. | Run completion moves to review, approve/reject endpoints record feedback and move task forward/back. | Partial |
| Run evidence | Run log path, event path, run status endpoint, logs endpoint, events endpoint, review-packet diff and test summary. | Run link stores session/run IDs, result text, status, error, feedback; evidence mostly via Nerve sessions. | CodexUI ahead on local artifacts |
| Worktree handling | Managed git worktrees per run; cleanup endpoint requires loopback, inactive run, audit record, typed confirmation. | No equivalent per-task managed worktree model in inspected Kanban implementation. | CodexUI ahead |
| Audit/security | Hash-chain audit log, CSRF, loopback mutation requirements, risk classifier, disabled execution over remote access. | Rate-limited routes and validation; richer workflow controls but less local mutation hardening in inspected Kanban surface. | CodexUI ahead |
| UI density | Board columns, mobile status tabs, card detail sheet/inspector, criteria controls, status actions, proposal count. | Board, cards, columns, header, quick view, detail drawer, proposal inbox, assignee combobox, drag/drop. | Partial |
| Agent-facing docs/API | Implementation plan and server endpoints exist, but no dedicated skill/API reference for agents yet. | Dedicated `nerve-kanban` skill and API reference for agents. | Missing Nerve parity |

## Functional Equivalents

The following Nerve concepts have a clear CodexUI equivalent, even if names differ:

| Nerve concept | CodexUI equivalent |
|---|---|
| `todo` | `ready` |
| `in-progress` | `running` |
| Reject from review back to work | `rework` state |
| Run task | Start Kanban run through Codex bridge |
| Abort running task | Interrupt run |
| Proposal inbox | Proposal list plus accept/reject endpoints, currently simpler |
| File-backed board data | Per-project Kanban state file |
| Agent run result review | Review packet from managed worktree diff/test evidence |

## Key Missing Nerve Parity In CodexUI

1. Configurable board model.

   CodexUI has fixed statuses and policy. Nerve exposes `/api/kanban/config` and persists columns, WIP limits, defaults, review-required behavior, proposal policy, default model, and default thinking level.

2. CAS-versioned API mutations.

   CodexUI increments task versions but does not require the client to submit the expected version. Nerve requires versions for updates/reorder and returns `version_conflict` with the latest task.

3. Reordering and drag/drop.

   CodexUI can change task status but has no `columnOrder` model or reorder endpoint. Nerve has both store support and UI drag/drop.

4. Rich task metadata.

   CodexUI lacks priority, assignee, createdBy actor, source session, result/resultAt, model/thinking, due date, estimate, actual duration, and feedback entries. CodexUI does have stronger acceptance criteria support than Nerve.

5. Agent proposal protocol.

   CodexUI proposals are simple task-creation suggestions. Nerve proposals can create or update tasks, carry source session and actor metadata, and are generated automatically from parsed agent markers.

6. Agent execution completion capture.

   CodexUI starts a Codex turn and records local run lifecycle/log/event files. It does not yet poll or subscribe to Codex turn completion, ingest final assistant output as task result, parse markers, or automatically transition successful runs through review. Nerve has polling/webhook completion paths and result persistence.

7. Agent assignment/routing.

   CodexUI runs the task in a managed worktree through the Codex bridge. Nerve can assign tasks to operator/agent actors and target live parent agent sessions for fallback subagent launch.

8. Server-side query API.

   CodexUI exposes a full state snapshot. Nerve exposes list filtering/search/pagination as first-class API behavior.

9. Agent-facing reference material.

   Nerve has a dedicated `nerve-kanban` skill and API reference. CodexUI does not yet have the equivalent task-authoring and agent-marker reference.

## CodexUI Advantages To Preserve

1. Local execution guardrails.

   CodexUI's execution is intentionally restricted: feature flag, loopback-only execution mutations, CSRF on mutations, safe sandbox/approval/network policy, and active-run limits. This should not be weakened to match Nerve behavior.

2. Managed worktree isolation.

   CodexUI creates one run worktree and branch per task run. This is stronger than Nerve's session-centric model for repository code changes and gives clear cleanup semantics.

3. Review packets.

   CodexUI generates review packets with diff summary, hash, test result slots, and unresolved proposal references. This is a good foundation for PR-quality review and should remain central.

4. Audit trail.

   CodexUI records security and workflow events through an audit log. That gives better forensic value than treating task JSON alone as the system of record.

5. Acceptance criteria.

   CodexUI's first-class acceptance criteria are more implementation-plan-friendly than Nerve's generic task descriptions.

## Recommended Parity Roadmap

### Phase 1: Data/API compatibility

- Add optional task fields for `priority`, `createdBy`, `assignee`, `sourceSessionKey`, `model`, `thinking`, `dueAt`, `estimateMin`, `actualMin`, `result`, `resultAt`, and `feedback`.
- Add server-side list filtering/search/pagination while preserving `/state` for the board UI.
- Require expected task `version` on update, status change, criteria replacement, archive, and future reorder mutations.
- Add `columnOrder` and reorder endpoint before drag/drop UI.

### Phase 2: Board config parity

- Add persisted board config with columns, WIP limits, defaults, review policy, proposal policy, and default model/thinking.
- Keep the current fixed statuses as the migration default.
- Map existing `ready` and `running` names carefully if introducing Nerve-compatible `todo` and `in-progress` aliases.

### Phase 3: Agent collaboration parity

- Extend proposals to support `type: create | update`, structured payloads, actor/source metadata, version, and resolution metadata.
- Add marker parsing and stripping for agent outputs.
- Implement a safe completion ingestion path from the Codex bridge so run completion can store result text, create marker proposals, and move tasks to review automatically.

### Phase 4: UI parity

- Add drag/drop only after `columnOrder` and CAS conflicts exist server-side.
- Add priority/assignee controls and filtering.
- Add a full proposal inbox surface for create/update proposals.
- Add a compact quick-view mode if repeated task scanning becomes a real workflow need in CodexUI.

### Phase 5: Agent reference

- Add a CodexUI Kanban API/agent reference modeled after Nerve's `nerve-kanban` skill, but updated for CodexUI's stronger safety constraints and worktree workflow.

## Bottom Line

CodexUI should not try to become Nerve by removing guardrails. The right target is "Nerve workflow parity plus CodexUI execution safety." The highest-value next parity work is CAS updates, configurable board metadata, richer task fields, proposal create/update payloads, and completion ingestion from Codex runs. Drag/drop and UI polish should follow the server-side model changes, not precede them.
