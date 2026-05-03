# Computer Use Direct Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `using-superpowers:executing-plans` to implement this plan.

**Goal:** Add a mobile-friendly codexUI Computer Use page/pane that drives the same Linux Computer Use backend used by Codex Desktop as directly as possible.

**Architecture:** codexUI should host its own managed `codex-computer-use-linux mcp` child process and expose a narrow `/codex-api/computer-use/*` bridge to the Vue UI. Reuse the desktop backend binary and MCP protocol; do not try to attach to an already-running desktop-owned MCP child process.

**Tech Stack:** Vite middleware, Node child process stdio, newline-delimited MCP JSON-RPC, Vue 3, TypeScript, existing `ContentHeader`/`HeaderGitBranchDropdown`/right-pane patterns.

---

## Current Evidence

Desktop/Linux Computer Use is present in the checked-out Linux desktop project at `/home/drj/tools/codex-desktop-linux`. Its README describes Linux Computer Use as an opt-in plugin backed by the native Rust MCP server `codex-computer-use-linux`. It uses:

- AT-SPI (`org.a11y.Bus`) for app listing and accessibility trees.
- GNOME Shell DBus screenshots first, then XDG Desktop Portal screenshot fallback.
- `ydotool` and `ydotoold` for keys, text, click, scroll, and drag.

The plugin manifest says `Computer Use` is "Control Linux desktop apps from Codex", and its `.mcp.json` registers:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "./bin/codex-computer-use-linux",
      "args": ["mcp"],
      "cwd": "."
    }
  }
}
```

The local binary at `/home/drj/tools/codex-desktop-linux/codex-cua-lab-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux` works.

Verified direct commands:

- `codex-computer-use-linux --help` lists `mcp`, `doctor`, `setup`, `setup-window-targeting`, `apps`, `state [APP_NAME]`, `screenshot`, and `windows`.
- `doctor` reports AT-SPI, `ydotool`, `ydotoold`, `/dev/uinput`, and screenshot support as working on this host.
- `doctor` also reports Cinnamon/X11 window targeting gaps: window listing/focus are unavailable because GNOME Shell introspection and the Codex GNOME Shell extension are not present. This does not block screenshot, AT-SPI, or global ydotool input.
- `apps` returns AT-SPI app roots.
- `windows` returns an empty list with a GNOME/Codex extension unavailable error on this Cinnamon session.
- `screenshot` succeeds and reports a PNG data URL length, source `gnome-shell`.

Verified MCP stdio behavior:

- `codex-computer-use-linux mcp` accepts newline-delimited JSON-RPC.
- `initialize` returns protocol version `2024-11-05`, server name `codex-computer-use-linux`, version `0.1.0`, and tool capabilities.
- `tools/list` exposes:
  - `doctor`
  - `setup_accessibility`
  - `setup_window_targeting`
  - `list_apps`
  - `list_windows`
  - `focused_window`
  - `activate_window`
  - `get_app_state`
  - `click`
  - `perform_action`
  - `set_value`
  - `scroll`
  - `drag`
  - `press_key`
  - `type_text`
- `tools/call` works for `doctor` and returns normal MCP content text containing JSON.

Desktop CDP inspection showed Browser Use and Computer Use are separate desktop plugins. Browser Use creates the in-app browser webview panel; Computer Use is the desktop-control capability. The browser webview should not be treated as the Computer Use backend.

## Main Decision

Spawn and manage codexUI's own `codex-computer-use-linux mcp` process.

Do not attempt to reuse a live process already spawned by Codex Desktop. Those desktop-owned MCP children are stdio-attached to their parent Electron/Codex runtime. After they are spawned, codexUI has no supported way to safely take over their stdin/stdout, correlate request IDs, or recover lifecycle state. Sharing one backend process between two hosts would also make cached accessibility nodes, pointer sessions, and action ordering ambiguous.

This still runs Computer Use "as closely as possible to desktop" because it uses the same binary, same plugin-provided MCP server, same tools, same diagnostics, same screenshot backend, and same ydotool/AT-SPI stack. The only difference is that codexUI is the MCP host instead of Electron/Codex Desktop.

## Binary Resolution

Add a small server-side resolver in `src/server/computerUseBridge.ts`.

Resolution order:

1. `CODEXUI_COMPUTER_USE_BINARY`
2. `/opt/codex-desktop/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux`
3. `/home/drj/tools/codex-desktop-linux/codex-cua-lab-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux`
4. `/home/drj/tools/codex-desktop-linux/codex-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux`
5. `/home/drj/tools/codex-desktop-linux/target/release/codex-computer-use-linux`

Expose the resolved path in status responses so drift is visible.

Optional env:

- `CODEXUI_COMPUTER_USE_DISABLED=1`: hide/disable the page.
- `CODEXUI_COMPUTER_USE_BINARY=/path/to/codex-computer-use-linux`: force a binary.
- `CODEXUI_COMPUTER_USE_ALLOW_REMOTE=1`: allow action endpoints when the request host is not loopback. For this machine, Tailscale Serve can use it, but keep the flag explicit.
- `CODEXUI_COMPUTER_USE_FORCE_YDOTOOL_POINTER=1`: pass through to backend when portal pointer sessions are not desired.

## Server Bridge

Add `src/server/computerUseBridge.ts` and register it from `createCodexBridgeMiddleware` in `src/server/codexAppServerBridge.ts`, near the existing `handleReviewRoutes` and terminal routes.

Recommended server objects:

- `ComputerUseBinaryResolver`
  - resolves executable
  - returns path, exists, executable bit, source label
- `ComputerUseMcpClient`
  - spawns `[binary, "mcp"]`
  - sends newline-delimited JSON-RPC
  - runs `initialize`, `notifications/initialized`, and `tools/list`
  - exposes `callTool(name, arguments)`
  - serializes calls through one queue initially
  - restarts on exit/error
  - provides `dispose()`
- `ComputerUseStatusCache`
  - stores latest doctor result, tool list, process PID, last error, last screenshot metadata

Register `dispose()` on Vite server close, matching existing bridge lifecycle cleanup.

### HTTP Endpoints

Read-only diagnostics:

- `GET /codex-api/computer-use/status`
  - resolved binary path/source
  - MCP process running/pid
  - initialized/tool count
  - parsed `doctor` summary
  - important readiness booleans
  - last error
- `GET /codex-api/computer-use/tools`
  - MCP `tools/list` output, normalized for UI/debug
- `GET /codex-api/computer-use/apps`
  - MCP `list_apps`
- `GET /codex-api/computer-use/windows`
  - MCP `list_windows`
- `POST /codex-api/computer-use/state`
  - body can include `{ appName, windowId, pid, title, wmClass, maxNodes, maxDepth, includeScreenshot }`
  - calls MCP `get_app_state`
  - returns screenshot data URL, screenshot size, compact accessibility tree, diagnostics, and window context

Setup:

- `POST /codex-api/computer-use/setup-accessibility`
  - calls MCP `setup_accessibility`
- `POST /codex-api/computer-use/setup-window-targeting`
  - calls MCP `setup_window_targeting`
  - warn in UI when it requires shell reload

Actions:

- `POST /codex-api/computer-use/click`
  - accepts `{ x, y, button, clickCount }` or element selector fields
  - calls MCP `click`
- `POST /codex-api/computer-use/scroll`
  - accepts `{ x, y, direction, pages }` or `{ elementIndex, direction, pages }`
  - calls MCP `scroll`
- `POST /codex-api/computer-use/drag`
  - accepts `{ startX, startY, endX, endY }`
  - maps to MCP snake_case fields
- `POST /codex-api/computer-use/type-text`
  - accepts `{ text, windowId, pid, title, wmClass, terminalCwd, terminalCommand }`
  - calls MCP `type_text`
- `POST /codex-api/computer-use/press-key`
  - accepts `{ key, windowId, pid, title, wmClass, terminalCwd, terminalCommand }`
  - calls MCP `press_key`
- `POST /codex-api/computer-use/perform-action`
  - accepts element selector fields
  - calls MCP `perform_action`
- `POST /codex-api/computer-use/set-value`
  - accepts element selector fields plus `value`
  - calls MCP `set_value`

Keep a generic debug escape hatch for development only:

- `POST /codex-api/computer-use/tool`
  - body `{ name, arguments }`
  - gated behind `CODEXUI_COMPUTER_USE_DEBUG_TOOLS=1`

### Response Handling

The MCP `tools/call` result returns `content` blocks. For this backend, the first text block is JSON. Parse it when possible and return:

```ts
{
  ok: boolean,
  tool: string,
  result: unknown,
  rawContent: unknown[],
  error?: string
}
```

Do not discard `rawContent`; it is useful when upstream changes schema.

## Frontend Wiring

Add API helpers in `src/api/codexGateway.ts`:

- `getComputerUseStatus()`
- `getComputerUseApps()`
- `getComputerUseWindows()`
- `getComputerUseState(payload)`
- `computerUseClick(payload)`
- `computerUseScroll(payload)`
- `computerUseDrag(payload)`
- `computerUseTypeText(payload)`
- `computerUsePressKey(payload)`
- `computerUsePerformAction(payload)`
- `computerUseSetValue(payload)`
- setup helpers

Add shared types in `src/types/codex.ts`:

- `UiComputerUseStatus`
- `UiComputerUseApp`
- `UiComputerUseWindow`
- `UiComputerUseScreenshot`
- `UiComputerUseAccessibilityNode`
- `UiComputerUseState`
- `UiComputerUseActionResult`

Normalize backend snake_case to frontend camelCase in `codexGateway.ts`, like existing review normalization.

## UI Placement

Use the same dropdown surface that currently offers `Review`.

Current repo wiring:

- `HeaderGitBranchDropdown.vue` has a `Review` row and emits `toggleReview`.
- `App.vue` stores `isReviewPaneOpen`.
- `App.vue` renders `ReviewPane` in the content grid when `isReviewPaneOpen && selectedThreadId && composerCwd`.

Replace the single boolean with a panel selection:

```ts
type ContentSidePane = 'review' | 'computerUse' | null
const activeContentSidePane = ref<ContentSidePane>(null)
```

Then:

- `Review` selects/toggles `activeContentSidePane = 'review'`.
- `Computer Use` selects/toggles `activeContentSidePane = 'computerUse'`.
- Route/thread changes clear the active side pane where the review pane is currently cleared.
- The dropdown should show both rows only when a thread context is available.

Add `ComputerUsePane.vue` under `src/components/content/`.

## Mobile-First Computer Use Pane

The first useful version should be a full-height, mobile-friendly app-control surface, not only a diagnostics card.

Layout:

- Header
  - title: `Computer Use`
  - status chip: `Ready`, `Limited`, `Unavailable`
  - refresh button
  - close button
- Target selector
  - tabs: `Apps`, `Windows`
  - app/window search
  - selected target summary
- Main viewport
  - screenshot image from `get_app_state`
  - fixed aspect ratio from natural screenshot width/height
  - pinch/zoom or fit-width first; pan can be a follow-up
  - action overlay markers for last click/drag
- Controls drawer
  - mode segmented control: `Tap`, `Scroll`, `Drag`, `Element`
  - text input plus send button
  - key menu: Enter, Escape, Tab, Backspace, Ctrl+L, Ctrl+C, Ctrl+V
  - refresh state button
  - stop/disable actions button
- Accessibility tree sheet
  - searchable compact node list
  - click/action/set-value options for selected node

Coordinate mapping:

```ts
const rect = imageElement.getBoundingClientRect()
const x = Math.round((event.clientX - rect.left) * screenshot.width / rect.width)
const y = Math.round((event.clientY - rect.top) * screenshot.height / rect.height)
```

Clamp x/y to `[0, width - 1]` and `[0, height - 1]`. Use the screenshot natural dimensions returned by `get_app_state`, not displayed CSS size.

Action flow:

1. User selects app/window.
2. UI calls `get_app_state({ includeScreenshot: true })`.
3. User taps screenshot.
4. UI maps tap to screenshot pixels and posts `/computer-use/click`.
5. UI waits for action result.
6. UI refreshes `get_app_state` after a short delay.

For text:

1. User types text into the mobile browser input.
2. UI posts `type_text`.
3. UI refreshes state.

For scroll:

1. User uses vertical swipe or scroll buttons while in `Scroll` mode.
2. UI posts `scroll` with center point or gesture point and direction/pages.
3. UI refreshes state.

## Security Posture For This Install

The user explicitly accepts loopback/private-tailnet risk. Keep the implementation simple, but preserve one obvious safety lever.

Default:

- Read-only endpoints work from any Vite-allowed host.
- Action endpoints require loopback host unless `CODEXUI_COMPUTER_USE_ALLOW_REMOTE=1`.

For the user's Tailscale Serve target, set:

```bash
CODEXUI_COMPUTER_USE_ALLOW_REMOTE=1
```

This avoids building a full auth system now while still preventing accidental open-network desktop control if the dev server is later exposed beyond the tailnet.

## Implementation Steps

1. Create `src/server/computerUseBridge.ts`.
   - Implement binary resolution.
   - Implement command-level diagnostics helper for `--help` and direct `doctor` fallback.
   - Implement `ComputerUseMcpClient`.
   - Implement route handler `handleComputerUseRoutes(req, res, url, context)`.

2. Register the server route.
   - Import `handleComputerUseRoutes` in `src/server/codexAppServerBridge.ts`.
   - Call it after review routes and before thread-terminal routes.
   - Ensure bridge disposal kills the MCP child on Vite shutdown.

3. Add frontend API/types.
   - Add types in `src/types/codex.ts`.
   - Add helpers/normalizers in `src/api/codexGateway.ts`.

4. Add pane selection.
   - Replace `isReviewPaneOpen` with `activeContentSidePane`.
   - Keep Review behavior equivalent.
   - Add Computer Use row to `HeaderGitBranchDropdown.vue`.

5. Build `ComputerUsePane.vue`.
   - Status/diagnostics state.
   - App/window list.
   - Screenshot viewport.
   - Tap/click, scroll, drag, text, key actions.
   - Accessibility tree sheet.
   - Responsive mobile layout first; docked desktop layout second.

6. Add manual test documentation.
   - Update `tests.md`.
   - Include light and dark theme checks.
   - Include mobile phone via Tailscale Serve.
   - Include setup/rollback notes.

7. Optional durable docs after implementation.
   - Add `llm-wiki/raw/...` evidence source and `llm-wiki/wiki/...` concept page because this changes durable MCP/plugin behavior surfaced by codexUI.

## Verification Plan

Server-level:

```bash
pnpm run build
node -e "require('node:fs').accessSync('src/server/computerUseBridge.ts'); console.log('bridge source present')"
curl http://127.0.0.1:5173/codex-api/computer-use/status
curl http://127.0.0.1:5173/codex-api/computer-use/tools
curl http://127.0.0.1:5173/codex-api/computer-use/apps
```

MCP-level:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"codexui-probe","version":"0.0.0"}}}\n' \
  | /path/to/codex-computer-use-linux mcp
```

Unit tests to add if the repo test harness supports them:

- binary resolver path priority
- MCP line parser and request correlation
- tools/call content JSON parsing
- screenshot coordinate mapping
- action endpoint camelCase to snake_case mapping

Manual checks:

- Light theme desktop: open thread, dropdown shows Review and Computer Use, Review still works, Computer Use opens.
- Dark theme desktop: same surfaces readable and controls are dark-themed.
- Mobile viewport: Computer Use pane fills usable viewport, screenshot does not overflow, controls remain reachable with mobile keyboard open.
- Phone via Tailscale Serve: status loads; actions are blocked unless `CODEXUI_COMPUTER_USE_ALLOW_REMOTE=1`; after enabling, tap/click sends a desktop action.
- Failure state: temporarily point `CODEXUI_COMPUTER_USE_BINARY` to a missing path and confirm UI shows unavailable with the path source and error.

## Effort Estimate

Usable local MVP:

- Server bridge and MCP client: 1-2 days.
- Read-only status/apps/state screenshot UI: 1-2 days.
- Basic actions: tap/click, scroll buttons, type text, press key: 2-3 days.
- Tests/manual docs/theme cleanup: 1 day.

Total: about 1 week for a usable loopback/private-tailnet MVP.

Fully functional mobile implementation:

- Robust target selection and action refresh: 2-4 days.
- Accessibility tree search/actions/set-value: 2-4 days.
- Mobile gesture polish for tap/scroll/drag/keyboard: 4-7 days.
- Error recovery, process restart, stale screenshot handling, action queue UX: 2-4 days.
- Cross-theme/responsive QA and docs/wiki: 1-2 days.

Total: about 2-3 weeks for a genuinely usable mobile Computer Use page.

Production-grade general release:

- Hardened auth and exposure model.
- Multi-user/session isolation.
- Better window targeting outside GNOME.
- Broader desktop environment compatibility.
- Automated visual/integration coverage.

Total: 4-6 weeks.

## Risks And Constraints

- Cinnamon/X11 currently lacks the GNOME window list/focus path expected by the backend. Screenshot, AT-SPI, and ydotool input work; exact targeted window focus may remain limited unless the backend grows Cinnamon support or the user runs a GNOME session/extension path.
- `get_app_state` can return large screenshot data URLs. The UI should avoid polling too fast and should refresh after actions rather than continuously streaming at first.
- MCP action calls should be serialized initially. Pointer and cached accessibility-node state are process-local and can become inconsistent if multiple UI gestures run concurrently.
- Mobile browser touch gestures can conflict with page scrolling. The screenshot viewport must use explicit action modes and `touch-action` CSS.
- Tailscale Serve plus `allowedHosts` is already configured for the Vite host, but desktop-control action endpoints should still be gated by an explicit env flag.

## Preserve Existing Work

If dev branch already contains partial right-panel/sidebar work, preserve it by extracting only reusable ideas into this plan's implementation branch:

- Reuse generic layout utilities only if they are already compatible with `main`.
- Do not port kanban board or automations-page code.
- Do not port a generic desktop-like sidebar unless it directly supports `ComputerUsePane`.
- If useful right-panel code exists on `dev`, cherry-pick into a temporary worktree and copy only the minimal component/CSS pieces into the main-based feature branch.

Recommended implementation branch should be created from updated `main`, not from `dev`, because this is intended to be an upstreamable PR and upstream has no right sidebar baseline.

## Acceptance Criteria

- codexUI can resolve the installed Linux Computer Use binary or report a clear unavailable state.
- codexUI owns and cleans up its own MCP `codex-computer-use-linux mcp` child process.
- `/codex-api/computer-use/status` proves `doctor` and MCP registration work.
- The Computer Use pane can list apps, load state with a screenshot, click by screenshot coordinate, scroll, type text, and press common keys.
- The UI is usable on phone-sized screens over Tailscale Serve.
- Review pane behavior remains intact.
- `tests.md` documents light, dark, desktop, mobile, and Tailscale verification.
