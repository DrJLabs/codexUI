# Kanban Codex Agent Reference

This page defines the CodexUI Kanban agent contract for board tasks, Codex execution, proposal markers, and review handoff. It is written for CodexUI maintainers and agents that need to create, update, execute, or review Kanban tasks through `/codex-api/kanban`.

## Lifecycle

The normal task flow is:

```text
backlog -> ready -> running -> review -> done
```

Supporting states:

- `rework`: review found a problem and the task needs another Codex or operator pass.
- `cancelled`: execution or the task itself was stopped and should not continue without an explicit update.

Lifecycle rules:

- `backlog` is untriaged or intentionally parked work.
- `ready` is reviewed enough to run or be picked up manually.
- `running` is reserved for an active Codex run.
- `review` means execution finished, the task result was captured, and a review packet should be available or intentionally regenerated.
- `done` is a human-approved completed task.
- `rework` should include enough feedback for the next pass.
- `cancelled` is terminal until an operator deliberately changes the task.

## Codex Assignee Model

Kanban actors are Codex-specific:

- `operator`: a human operator owns the task or action.
- `codex:auto`: Codex may pick the task automatically when execution is requested.
- `codex:thread:<threadId>`: a specific Codex thread owns the task, proposal, or run result.

Use `codex:thread:<threadId>` when work is tied to a known conversation and `codex:auto` when the task is not bound to a particular Codex thread yet.

## Safe Execution Model

Kanban execution is intentionally narrower than general local development:

- Execution is available only through trusted local or Tailscale access.
- Mutating execution routes require a CSRF token from `GET /codex-api/kanban/csrf`.
- CSRF tokens are sent with the `x-codexui-kanban-csrf` header.
- Runs use managed worktrees so Codex work is isolated from the main project checkout.
- The execution policy uses `workspace-write`, `on-request` approval, and no network access by default.
- CodexUI starts runs, captures results, and prepares review artifacts.
- CodexUI does not automatically merge, push, open pull requests, or delete dirty worktrees.

The operator remains responsible for reviewing changes, approving proposals, merging branches, pushing commits, and creating pull requests.

## Marker Syntax

Codex can propose board changes by including fenced JSON markers in its final message. The marker is parsed out of the visible task result and converted into pending or automatically applied proposals according to board configuration.

Create proposal:

````markdown
```kanban:create
{
  "title": "Add retry telemetry",
  "description": "Record retry count and final status for failed sync attempts.",
  "priority": "normal",
  "assignee": "codex:auto",
  "labels": [{ "name": "Telemetry", "color": "#2563eb" }],
  "acceptanceCriteria": [
    { "text": "Retry count is captured for each failed sync." },
    { "text": "Manual verification steps are documented." }
  ]
}
```
````

Update proposal:

````markdown
```kanban:update
{
  "taskId": "task_abc123",
  "patch": {
    "title": "Add retry telemetry and docs",
    "priority": "high",
    "assignee": "codex:thread:019e-route",
    "estimateMinutes": 45
  }
}
```
````

Marker rules:

- The fence language must be `kanban:create` or `kanban:update`.
- The body must be valid JSON.
- Create payloads use the task create fields.
- Update payloads require `taskId` and a non-empty `patch`.
- Invalid markers are left in the result text and do not create proposals.

## Completion Behavior

When a Codex run finishes, CodexUI handles completion as follows:

1. Subscribe to Codex bridge notifications for `turn/completed`.
2. Read the completed thread with `thread/read`.
3. Extract the final assistant output for the completed turn.
4. Parse `kanban:create` and `kanban:update` marker blocks.
5. Store the marker-free result text on the task.
6. Create proposals from parsed markers using `codex:thread:<threadId>` when available.
7. Move the task to `review` and mark the run `succeeded`.
8. Generate a review packet with the task diff, summary, test result slots, and unresolved proposal IDs.

The manual fallback route `POST /codex-api/kanban/runs/:runId/complete` follows the same result capture, marker parsing, proposal creation, and review packet generation path.

## API Examples

All examples assume:

```bash
BASE_URL=http://127.0.0.1:5173/codex-api/kanban
CSRF_TOKEN=$(curl -s "$BASE_URL/csrf" | jq -r '.data.csrfToken')
```

### Create Task

```bash
curl -sS -X POST "$BASE_URL/tasks" \
  -H 'content-type: application/json' \
  -d '{
    "title": "Document sync retry behavior",
    "description": "Clarify retry handling and review evidence capture.",
    "priority": "normal",
    "assignee": "codex:auto",
    "acceptanceCriteria": [
      { "text": "Retry behavior is documented." },
      { "text": "Verification command is included." }
    ]
  }'
```

### Update Task

Task updates require the current task `version`.

```bash
curl -sS -X PATCH "$BASE_URL/tasks/task_abc123" \
  -H 'content-type: application/json' \
  -d '{
    "version": 3,
    "priority": "high",
    "assignee": "operator",
    "blockedReason": "Waiting for test fixture confirmation."
  }'
```

### Reorder Task

Move a task into a status and place it relative to neighboring tasks.

```bash
curl -sS -X POST "$BASE_URL/tasks/task_abc123/reorder" \
  -H 'content-type: application/json' \
  -d '{
    "version": 4,
    "status": "ready",
    "beforeTaskId": "task_before",
    "afterTaskId": "task_after"
  }'
```

Use either `beforeTaskId`, `afterTaskId`, both, or neither depending on the desired column position.

### Execute Task

Execution requires trusted access and CSRF.

```bash
curl -sS -X POST "$BASE_URL/tasks/task_abc123/run" \
  -H "x-codexui-kanban-csrf: $CSRF_TOKEN"
```

Successful startup returns `202` with the `run` and updated `task`.

### Complete Run

This is the manual fallback for completion. The `result` text may include marker fences.

````bash
curl -sS -X POST "$BASE_URL/runs/run_abc123/complete" \
  -H 'content-type: application/json' \
  -H "x-codexui-kanban-csrf: $CSRF_TOKEN" \
  -d '{
    "result": "Implemented the retry docs and verification notes.\n\n```kanban:update\n{\"taskId\":\"task_abc123\",\"patch\":{\"actualMinutes\":35}}\n```"
  }'
````

To complete with an error:

```bash
curl -sS -X POST "$BASE_URL/runs/run_abc123/complete" \
  -H 'content-type: application/json' \
  -H "x-codexui-kanban-csrf: $CSRF_TOKEN" \
  -d '{
    "result": "Could not complete the task.",
    "error": "Build failed before verification."
  }'
```

### Approve Proposal

Approving a create proposal creates the task. Approving an update proposal applies its patch.

```bash
curl -sS -X POST "$BASE_URL/proposals/proposal_abc123/approve" \
  -H 'content-type: application/json' \
  -H "x-codexui-kanban-csrf: $CSRF_TOKEN" \
  -d '{
    "resolvedBy": "operator",
    "reason": "Matches the review notes."
  }'
```

### Reject Proposal

```bash
curl -sS -X POST "$BASE_URL/proposals/proposal_abc123/reject" \
  -H 'content-type: application/json' \
  -H "x-codexui-kanban-csrf: $CSRF_TOKEN" \
  -d '{
    "resolvedBy": "operator",
    "reason": "Out of scope for this task."
  }'
```

## Review Packet

After successful completion, retrieve the review packet from:

```bash
curl -sS "$BASE_URL/tasks/task_abc123/review-packet"
```

A review packet includes the base commit, head commit, raw diff patch, file and line summary, test result slots, and unresolved proposal IDs. Treat it as a review starting point, not approval to merge.
