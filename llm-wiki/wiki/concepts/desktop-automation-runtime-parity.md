# Desktop Automation Runtime Parity

Source: [desktop-automation-runtime-parity.md](../../raw/features/desktop-automation-runtime-parity.md)

CodexUI automations use the same durable surfaces as Codex Desktop wherever possible:

- Definitions: `$CODEX_HOME/automations/<id>/automation.toml`
- Scheduler timing: SQLite `automations.next_run_at` and `automations.last_run_at`
- Run and inbox state: SQLite `automation_runs`

This lets one app edit or run an automation while the other app can read the same definition and runtime state without a CodexUI-only translation layer.

## Runtime Ownership

Codex Desktop should own scheduling when it is running. CodexUI's scheduler is a fallback and uses `CODEXUI_AUTOMATIONS_SCHEDULER`:

- `desktop` or unset: CodexUI does not schedule.
- `enabled`: CodexUI schedules even if Desktop detection would find Desktop.
- `auto`: CodexUI schedules only when Desktop process detection is supported and Desktop is not active.

The API exposes scheduler ownership state so the UI can tell whether scheduling is Desktop-owned, CodexUI-owned, or disabled because detection is unsupported.

## Compatibility Boundary

Desktop TOML and SQLite are canonical for fields Desktop understands. CodexUI does not add separate automation permission policy on top of the app's existing run profile and execution policy wiring.

CodexUI still stores private run details locally where Desktop has no matching schema, but those local files are not the shared automation contract.

## Legacy Migration

Legacy `scheduler.json` timing and `runs/*/run.json` history are copied into Desktop SQLite once. The migration writes `.codexui-runtime-migrated-to-desktop-sqlite` under the automations root to avoid repeating work.
