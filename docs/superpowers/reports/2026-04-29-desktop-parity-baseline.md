# Desktop-Parity Baseline Report

Date: 2026-04-29
Branch: `feature/desktop-parity-baseline-dev`
Worktree: `$HOME/projects/codexUI-desktop-parity-baseline-dev`
Base: local `dev` at `873ef780670063f29438ead5403bf057ff7c20d0`
Plan source: `$HOME/projects/codexUI-desktop-parity-plan-dev/docs/superpowers/plans/2026-04-29-codex-desktop-parity-implementation-plan.md`

## Purpose

This report completes Phase 0 of the desktop-parity implementation plan. It records the available Codex.app evidence, the installed Codex runtime/schema truth, and the protocol facts that Phase 1 and Phase 2 must use before changing execution modes or run profiles.

No runtime or UI behavior changed in this phase.

## Codex.app Availability

Command:

```bash
test -e /Applications/Codex.app; echo $?
```

Result:

```text
1
```

Conclusion:

`/Applications/Codex.app` is absent on this Linux host. Live Codex.app CDP inspection and `app.asar` extraction cannot be performed here. UI parity work on this host must use the documented fallback path: rely on existing repo behavior and local Codex references, then capture Codex.app CDP evidence later from a macOS host before user-visible parity claims.

## Local Codex Reference State

Command:

```bash
sed -n '1,120p' $HOME/.codex/docs/codex/README.md
```

Evidence:

- The saved reference surface says it was last refreshed `2026-04-23T05:44:52-04:00`.
- The saved reference surface says its installed CLI snapshot was `codex-cli 0.122.0`.
- It recommends using installed runtime help first, then the upstream config schema snapshot.

Current installed runtime command:

```bash
codex -V
```

Result:

```text
codex-cli 0.125.0
```

Conclusion:

The installed runtime has drifted past the saved local reference snapshot. Implementation must prefer freshly generated `0.125.0` app-server schemas over the saved `0.122.0` reference when deciding request payload shapes.

## Fresh App-Server Schema Generation

Commands:

```bash
rm -rf /tmp/codexui-desktop-parity-schema
mkdir -p /tmp/codexui-desktop-parity-schema
codex app-server generate-json-schema --experimental --out /tmp/codexui-desktop-parity-schema

rm -rf /tmp/codexui-desktop-parity-ts
mkdir -p /tmp/codexui-desktop-parity-ts
codex app-server generate-ts --experimental --out /tmp/codexui-desktop-parity-ts
```

Result:

- JSON schema generated successfully under `/tmp/codexui-desktop-parity-schema`.
- TypeScript bindings generated successfully under `/tmp/codexui-desktop-parity-ts`.

Important generated files:

- `/tmp/codexui-desktop-parity-ts/v2/TurnStartParams.ts`
- `/tmp/codexui-desktop-parity-ts/v2/ThreadStartParams.ts`
- `/tmp/codexui-desktop-parity-ts/v2/ThreadResumeParams.ts`
- `/tmp/codexui-desktop-parity-ts/v2/PermissionProfile.ts`
- `/tmp/codexui-desktop-parity-ts/v2/SandboxPolicy.ts`
- `/tmp/codexui-desktop-parity-ts/v2/PermissionsRequestApprovalParams.ts`
- `/tmp/codexui-desktop-parity-ts/v2/PermissionsRequestApprovalResponse.ts`

## Current Protocol Facts From `codex-cli 0.125.0`

### `turn/start`

Generated `TurnStartParams` accepts:

- `threadId: string`
- `input: Array<UserInput>`
- optional `responsesapiClientMetadata`
- optional `environments`
- optional `cwd`
- optional `approvalPolicy`
- optional `approvalsReviewer`
- optional `sandboxPolicy`
- optional `permissionProfile`
- optional `model`
- optional `serviceTier`
- optional `effort`
- optional `summary`
- optional `personality`
- optional `outputSchema`
- optional `collaborationMode`

Important constraint:

```text
permissionProfile cannot be combined with sandboxPolicy.
```

Run-profile implementation must choose exactly one permissions lane for a given turn.

### `thread/start` and `thread/resume`

Generated `ThreadStartParams` and `ThreadResumeParams` accept:

- `approvalPolicy`
- `approvalsReviewer`
- `sandbox`
- `permissionProfile`
- `config`
- model/provider/service-tier overrides
- instruction/personality fields

Important constraint:

```text
permissionProfile cannot be combined with sandbox.
```

This differs from `turn/start`, where the mutually exclusive legacy field is `sandboxPolicy`.

### Permission Profile Shape

Generated `PermissionProfile` is:

```text
managed: network + fileSystem
disabled
external: network
```

Generated filesystem permission profile supports:

```text
restricted entries
unrestricted
```

Generated network permission profile is currently:

```text
enabled: boolean
```

### Sandbox Policy Shape

Generated `SandboxPolicy` supports:

```text
dangerFullAccess
readOnly
externalSandbox
workspaceWrite
```

`workspaceWrite` includes:

```text
writableRoots
readOnlyAccess
networkAccess
excludeTmpdirEnvVar
excludeSlashTmp
```

### Approval Requests

Generated server request union includes:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `mcpServer/elicitation/request`
- legacy `applyPatchApproval`
- legacy `execCommandApproval`

Generated `PermissionsRequestApprovalParams` includes:

- `threadId`
- `turnId`
- `itemId`
- `cwd`
- `reason`
- `permissions`

Generated `PermissionsRequestApprovalResponse` returns:

- `permissions`
- `scope`
- optional `strictAutoReview`

This confirms Phase 1/2 should preserve the existing broad approval normalization already present in `src/composables/useDesktopState.ts` and should add Kanban/run-profile approval behavior through the current pending-request model rather than a parallel approval channel.

## Current Repo Runtime Mismatch

Focused search:

```bash
rg -n "turn/start|sandboxMode|approvalPolicy|networkAccess|permissionProfile|permissions|default_permissions|sandbox_mode|approval_policy|writableRoots|writable_roots" src/server src/api src/types -S
```

Current Kanban runner sends:

```ts
await this.bridge.rpc<Record<string, unknown>>('turn/start', {
  threadId: run.threadId,
  cwd: run.worktreePath,
  prompt,
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
})
```

This is not aligned with the fresh generated `TurnStartParams` shape, which uses:

- `input`, not `prompt`
- `sandboxPolicy`, not `sandboxMode`
- `permissionProfile`, mutually exclusive with `sandboxPolicy`
- no top-level `networkAccess`; network belongs inside `sandboxPolicy` or `permissionProfile`

Phase 2 must introduce a narrow adapter that maps CodexUI run profiles to the generated `0.125.0` app-server payload shape before broadening execution profiles.

## Config Reference Facts

Command:

```bash
rg -n "sandbox_mode|approval_policy|network_access|writable_roots|permission" $HOME/.codex/docs/codex -S
```

Relevant local config reference facts:

- `approval_policy` supports `untrusted`, `on-failure`, `on-request`, and `never`.
- `approvals_reviewer` supports `user`, `auto_review`, and `guardian_subagent`.
- `sandbox_mode` supports `read-only`, `workspace-write`, and `danger-full-access`.
- `sandbox_workspace_write` includes `network_access` and `writable_roots`.
- `permissions` and `default_permissions` are present as named permission-profile config surfaces.
- runtime feature flags list `exec_permission_approvals` and `request_permissions_tool` as under development/disabled in the saved reference, so Phase 2 should not assume request-permissions UX is fully stable without runtime testing.

## Implementation Guidance For Next Phases

### Phase 1: Execution Modes

Proceed with the existing plan:

- split access context from execution capability;
- keep disabled as default;
- keep loopback/Tailscale behavior explicit and audited;
- leave `open_remote` blocked until a real authenticated remote-user model exists.

Phase 1 should not change the app-server run payload yet except where necessary to preserve current behavior.

### Phase 2: Run Profiles

Before exposing run-profile UI, implement and test:

```ts
resolveCodexTurnStartRunSettings(profile, schemaCapabilities)
```

The adapter should emit either:

- `sandboxPolicy` plus `approvalPolicy`; or
- `permissionProfile` plus `approvalPolicy`;

but never both `sandboxPolicy` and `permissionProfile`.

For `thread/start` or `thread/resume`, the same profile must map to `sandbox` or `permissionProfile`, not `sandboxPolicy`.

Recommended safe first profile mapping:

- Read-only planning -> `sandboxPolicy: { type: 'readOnly', ... }`
- Workspace coding -> `sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: [worktreePath], ... }`
- Workspace coding + network -> same workspace policy with network enabled
- Full-access operator -> high-friction `permissionProfile` or `sandboxPolicy: { type: 'dangerFullAccess' }`, only after explicit confirmation and tests

## Verification Commands Run

```bash
test -e /Applications/Codex.app; echo $?
sed -n '1,120p' $HOME/.codex/docs/codex/README.md
rg -n "sandbox_mode|approval_policy|network_access|writable_roots|permission" $HOME/.codex/docs/codex -S
codex -V
codex app-server generate-json-schema --experimental --out /tmp/codexui-desktop-parity-schema
codex app-server generate-ts --experimental --out /tmp/codexui-desktop-parity-ts
rg -n "turn/start|sandboxMode|approvalPolicy|networkAccess|permissionProfile|permissions|default_permissions|sandbox_mode|approval_policy|writableRoots|writable_roots" src/server src/api src/types -S
```

All commands completed successfully except the deliberate Codex.app existence check, which returned `1` because the macOS app bundle is absent on this host.

## Phase 0 Acceptance Status

- Codex.app availability recorded: complete.
- Local Codex reference snapshot recorded: complete.
- Installed runtime drift recorded: complete.
- Fresh app-server schema generated: complete.
- `turn/start` run-setting payload documented: complete.
- Permission-profile decision recorded: complete. `permissionProfile` exists in `0.125.0`, but must be adapter-gated and mutually exclusive with `sandboxPolicy`/`sandbox`.
- Runtime/UI behavior changes: none.
