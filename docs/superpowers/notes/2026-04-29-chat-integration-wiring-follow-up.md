# Chat Integration Wiring Follow-Up

This is a durable follow-up note for the desktop-parity work after the thread workspace/right drawer IA phase.

## Status

Deferred. Do not implement automatic proposal tasks or chat-triggered Kanban mutations in the immediate right drawer IA phase.

## Reason

Automatic proposal tasks and chat-integrated Kanban capabilities require a clean contract between chat sessions, Kanban tasks, proposals, runs, and artifacts. The current priority is to make the right drawer and thread workspace model stable first. Implementing automation before that model exists risks coupling chat messages directly to Kanban internals and creating duplicate or unsafe task creation paths.

## Follow-Up Scope

The later chat integration wiring phase should decide and implement:

- How a chat session is bound to a Kanban task or workspace context.
- Which chat events become hooks.
- How hooks are persisted and replayed safely.
- How proposal markers in chat messages become inert proposals.
- Whether `proposalPolicy: auto` can auto-approve inert proposals only, or whether it can create tasks after explicit operator enablement.
- How duplicate proposals/tasks are prevented across retries, refreshes, and resumed sessions.
- How the right drawer displays chat-generated proposals.
- How evidence links a chat turn to a proposal, task, run, and artifact.

## Default Policy Until Then

- Keep automatic proposal behavior off by default.
- Keep `proposalPolicy: auto` available as an advanced toggle, but do not expand its behavior in the right drawer IA phase.
- Keep proposals inert until a human or explicit later policy promotes them.
- Do not start runs from chat hooks.
- Do not let chat integrations bypass run profile, execution mode, approval, or artifact access policies.

## JIT Questions For The Later Phase

Before implementation, answer these in a new just-in-time plan:

1. What is the canonical identifier for a chat thread in the server state?
2. Can a thread be attached to more than one Kanban task?
3. Can a Kanban task own more than one chat thread?
4. What event creates a proposal from chat: message send, turn completion, marker parse, or explicit user action?
5. What idempotency key prevents duplicate proposals?
6. What should happen if the source chat message is edited, deleted, or no longer visible?
7. Which right drawer section owns chat-generated proposals?
8. What exact toggle enables any automatic promotion, and where is it displayed?

## Success Criteria For The Later Phase

- Chat-generated proposals are visible in the right drawer.
- Proposals remain inert unless explicitly accepted or a later, explicit automation policy allows promotion.
- Duplicate proposals are not created on refresh or retry.
- Chat hooks respect execution mode and run profile policy.
- Tests prove hook idempotency and policy enforcement.
