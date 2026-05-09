# Desktop Automation Runtime Parity Source Notes

Date: 2026-05-09

Source branch: `feature/automation-standalone-desktop-parity`

The automation runtime parity work makes Desktop TOML and Desktop SQLite the shared compatibility surface between CodexUI and Codex Desktop.

Canonical definitions remain under `$CODEX_HOME/automations/<id>/automation.toml`. CodexUI-specific local metadata stays in sidecar files only where Desktop has no equivalent field.

Runtime scheduler timing is stored in `$CODEX_HOME/sqlite/codex-dev.db` when that database exists, otherwise `$CODEX_HOME/sqlite/codex.db`. The `automations` table stores `next_run_at` and `last_run_at` as millisecond timestamps.

Run and inbox state is mirrored into Desktop's `automation_runs` table with Desktop status names: `IN_PROGRESS`, `PENDING_REVIEW`, `ACCEPTED`, and `ARCHIVED`.

CodexUI keeps local run JSON only for private implementation details that Desktop SQLite does not model, such as detailed event and log file paths. These files are no longer the cross-app contract.

Legacy CodexUI runtime files are migrated once into Desktop SQLite. The marker file is `$CODEX_HOME/automations/.codexui-runtime-migrated-to-desktop-sqlite`.

CodexUI's fallback scheduler defaults to Desktop ownership. In `auto` mode, CodexUI ticks only when supported process detection does not find an active Codex Desktop process. Detection support covers Linux, macOS, and Windows process snapshots.

The fallback scheduler cadence is 30 seconds and the per-tick run cap is 3, matching observed Desktop behavior more closely than the previous 60-second CodexUI-only cadence.
