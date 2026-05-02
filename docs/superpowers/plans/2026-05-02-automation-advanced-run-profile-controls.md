# Automation Advanced Run Profile Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the automation editor's Advanced tab use menu-based model, reasoning effort, and run-profile selection, with run-profile choices populated from the user's actual Codex `config.toml` profiles instead of a vague free-text profile ID box.

**Architecture:** Keep the automation definition fields unchanged (`runProfileId`, `model`, `reasoningEffort`) so existing native/sidecar storage remains compatible. Add a small execution-options catalog to the Automations state payload, sourced from built-in run profiles plus `config/read` `profiles`, then render Advanced as an editable execution settings panel with selects and profile summaries. Move model/reasoning controls out of the primary form grid and into Advanced, but keep them easy to change by opening Advanced by default.

**Tech Stack:** Vue 3 composition API, TypeScript, Express automation routes, existing Codex bridge `config/read`, Vitest, Playwright for requested browser verification.

---

## File Structure

- Modify: `src/types/execution.ts`
  - Add optional `source` metadata to `CodexRunProfile` so the UI can distinguish built-in app profiles from config profiles without changing execution behavior.
- Modify: `src/types/automations.ts`
  - Add `executionOptions` to `AutomationsState` with `runProfiles`, `defaultRunProfileId`, and `currentConfigProfileId`.
- Modify: `src/server/execution/runProfiles.ts`
  - Add a normalizer that converts Codex `config.toml` `[profiles.<id>]` entries from `config/read` into `CodexRunProfile` objects, resolving partial profile entries against explicit top-level config defaults.
- Modify: `src/server/execution/__tests__/runProfiles.test.ts`
  - Cover config profile normalization, snake_case config keys, supported Codex enum values (`none`, `minimal`, `on-failure`), partial-profile inheritance from top-level config defaults, fallback defaults, and built-in/profile merge order.
- Modify: `src/server/automations/service.ts`
  - Read `config/read` through `options.bridge?.rpc`, merge actual config profiles with built-ins, and include them in `listState()`.
- Modify: `src/server/automations/policy.ts`
  - Preserve `none` and `minimal` automation reasoning overrides instead of dropping them to profile defaults.
- Modify: `src/server/automations/routes.ts`
  - Pass config-derived run profiles into manual run execution so "Run now" resolves the same selected profile the UI exposed.
- Modify: `src/server/automations/__tests__/routes.test.ts`
  - Cover `/state` exposing profile options and manual runs receiving config profiles.
- Modify: `src/api/automationsGateway.ts`
  - No endpoint change expected; ensure the normalized payload still flows through `loadAutomationsState()`.
- Modify: `src/composables/useAutomations.ts`
  - Use `executionOptions.defaultRunProfileId` when creating empty drafts so the select has a concrete default while persistence can still send `null` when unchanged.
- Modify: `src/components/automations/AutomationsPage.vue`
  - Remove model/reasoning from the primary field grid.
  - Replace the Advanced free-text `Run profile id` input with a `select`.
  - Add model and reasoning `select`s beside it in Advanced.
  - Add a compact selected-profile summary showing sandbox, approval, network, and profile default model/reasoning.
- Modify: `tests.md`
  - Append/update manual test coverage for Advanced execution settings in light and dark theme.

---

### Task 1: Normalize Codex Config Profiles For Automation Menus

**Files:**
- Modify: `src/types/execution.ts`
- Modify: `src/server/execution/runProfiles.ts`
- Test: `src/server/execution/__tests__/runProfiles.test.ts`

- [x] **Step 1: Add source metadata to the shared run-profile type**

In `src/types/execution.ts`, extend `CodexRunProfile`:

```ts
export type CodexRunProfileSource = 'builtin' | 'config'

export type CodexRunProfile = {
  id: string
  name: string
  description: string
  model: string
  reasoningEffort: CodexRunProfileReasoningEffort
  sandboxMode: CodexRunProfileSandboxMode
  approvalPolicy: CodexRunProfileApprovalPolicy
  networkAccess: boolean
  writableRoots: string[]
  createdAtIso: string
  updatedAtIso: string
  source?: CodexRunProfileSource
}
```

Rationale: optional metadata avoids updating every existing test fixture immediately, while new profile-menu UI can still group/label options.

- [x] **Step 2: Mark built-in profiles as built-in**

In `src/server/execution/runProfiles.ts`, add `source: 'builtin'` to every object in `BUILTIN_CODEX_RUN_PROFILES`.

- [x] **Step 3: Add config-profile normalization**

In `src/server/execution/runProfiles.ts`, add:

```ts
export type CodexConfigProfileMap = Record<string, unknown>

export type CodexConfigProfileDefaults = {
  model?: string | null
  reasoningEffort?: CodexRunProfileReasoningEffort | null
  sandboxMode?: CodexRunProfileSandboxMode | null
  approvalPolicy?: CodexRunProfileApprovalPolicy | null
  networkAccess?: boolean | null
}

export function normalizeCodexConfigProfiles(value: unknown, defaults: CodexConfigProfileDefaults = {}): CodexRunProfile[] {
  if (!isRecord(value)) return []
  const normalized: CodexRunProfile[] = []
  const timestamp = new Date().toISOString()
  const fallbackProfile = BUILTIN_CODEX_RUN_PROFILES.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)!
  const fallbackModel = readString(defaults.model) || fallbackProfile.model
  const fallbackReasoningEffort = defaults.reasoningEffort ?? fallbackProfile.reasoningEffort
  const fallbackSandboxMode = defaults.sandboxMode ?? fallbackProfile.sandboxMode
  const fallbackApprovalPolicy = defaults.approvalPolicy ?? fallbackProfile.approvalPolicy
  const fallbackNetworkAccess = defaults.networkAccess ?? fallbackProfile.networkAccess
  for (const [id, rawProfile] of Object.entries(value)) {
    if (!id.trim() || !isRecord(rawProfile)) continue
    const model = readString(rawProfile.model)
    const reasoningEffort = readOptionalReasoningEffort(rawProfile.model_reasoning_effort ?? rawProfile.modelReasoningEffort)
      ?? fallbackReasoningEffort
    const sandboxMode = readOptionalSandboxMode(rawProfile.sandbox_mode ?? rawProfile.sandboxMode)
      ?? fallbackSandboxMode
    const approvalPolicy = readOptionalApprovalPolicy(rawProfile.approval_policy ?? rawProfile.approvalPolicy)
      ?? fallbackApprovalPolicy
    const networkAccess = readOptionalNetworkAccess(rawProfile) ?? fallbackNetworkAccess
    normalized.push({
      id: id.trim(),
      name: formatConfigProfileName(id),
      description: `Codex config.toml profile "${id.trim()}".`,
      model: model || fallbackModel,
      reasoningEffort,
      sandboxMode,
      approvalPolicy,
      networkAccess,
      writableRoots: [],
      createdAtIso: timestamp,
      updatedAtIso: timestamp,
      source: 'config',
    })
  }
  return normalized
}

export function mergeCodexRunProfiles(extra: CodexRunProfile[] | undefined): CodexRunProfile[] {
  const merged = new Map<string, CodexRunProfile>()
  for (const profile of BUILTIN_CODEX_RUN_PROFILES) merged.set(profile.id, profile)
  for (const profile of extra ?? []) merged.set(profile.id, profile)
  return Array.from(merged.values())
}

function formatConfigProfileName(id: string): string {
  return id
    .trim()
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || id.trim()
}

function readNetworkAccess(profile: Record<string, unknown>): boolean {
  if (profile.network_access === true || profile.networkAccess === true) return true
  const sandbox = isRecord(profile.sandbox_workspace_write)
    ? profile.sandbox_workspace_write
    : isRecord(profile.sandboxWorkspaceWrite)
      ? profile.sandboxWorkspaceWrite
      : null
  return sandbox?.network_access === true || sandbox?.networkAccess === true
}
```

Then update the existing `normalizeCodexRunProfiles()` implementation to call `mergeCodexRunProfiles(customProfiles)` instead of duplicating merge logic.

- [x] **Step 4: Add unit tests**

In `src/server/execution/__tests__/runProfiles.test.ts`, add:

```ts
import {
  mergeCodexRunProfiles,
  normalizeCodexConfigProfiles,
} from '../runProfiles'

it('normalizes Codex config.toml profiles for UI selection', () => {
  const profiles = normalizeCodexConfigProfiles({
    planning_fast: {
      model: 'gpt-5.4-mini',
      model_reasoning_effort: 'low',
      sandbox_mode: 'read-only',
      approval_policy: 'on-request',
    },
    'network-coding': {
      model: 'gpt-5.5',
      model_reasoning_effort: 'high',
      sandbox_mode: 'workspace-write',
      sandbox_workspace_write: { network_access: true },
    },
  })

  expect(profiles).toMatchObject([
    {
      id: 'planning_fast',
      name: 'Planning Fast',
      source: 'config',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      networkAccess: false,
    },
    {
      id: 'network-coding',
      name: 'Network Coding',
      source: 'config',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      sandboxMode: 'workspace-write',
      networkAccess: true,
    },
  ])
})

it('lets config.toml profiles override built-in profile ids', () => {
  const profiles = mergeCodexRunProfiles(normalizeCodexConfigProfiles({
    'workspace-coding': {
      model: 'gpt-5.5',
      model_reasoning_effort: 'xhigh',
      sandbox_mode: 'workspace-write',
    },
  }))

  expect(profiles.find((profile) => profile.id === 'workspace-coding')).toMatchObject({
    source: 'config',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
  })
})

it('preserves supported Codex config enum values', () => {
  const profiles = normalizeCodexConfigProfiles({
    minimal_profile: {
      model_reasoning_effort: 'minimal',
      approval_policy: 'on-failure',
    },
    no_reasoning: {
      model_reasoning_effort: 'none',
    },
  })

  expect(profiles.find((profile) => profile.id === 'minimal_profile')).toMatchObject({
    reasoningEffort: 'minimal',
    approvalPolicy: 'on-failure',
  })
  expect(profiles.find((profile) => profile.id === 'no_reasoning')).toMatchObject({
    reasoningEffort: 'none',
  })
})

it('normalizes partial config.toml profiles against top-level config values', () => {
  const profiles = normalizeCodexConfigProfiles({
    model_only: {
      model: 'gpt-5.5',
    },
  }, {
    model: 'gpt-5.4',
    reasoningEffort: 'minimal',
    sandboxMode: 'read-only',
    approvalPolicy: 'on-failure',
    networkAccess: true,
  })

  expect(profiles).toMatchObject([
    {
      id: 'model_only',
      model: 'gpt-5.5',
      reasoningEffort: 'minimal',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-failure',
      networkAccess: true,
    },
  ])
})
```

- [x] **Step 5: Run targeted tests**

Run:

```bash
pnpm vitest run src/server/execution/__tests__/runProfiles.test.ts
```

Expected: all tests pass.

- [x] **Step 6: Commit**

```bash
git add src/types/execution.ts src/server/execution/runProfiles.ts src/server/execution/__tests__/runProfiles.test.ts
git commit -m "feat: normalize codex config profiles"
```

---

### Task 2: Expose Profile Options In Automations State

**Files:**
- Modify: `src/types/automations.ts`
- Modify: `src/server/automations/policy.ts`
- Modify: `src/server/automations/service.ts`
- Modify: `src/server/automations/routes.ts`
- Test: `src/server/automations/__tests__/routes.test.ts`

- [x] **Step 1: Add execution options to `AutomationsState`**

In `src/types/automations.ts`, add to `AutomationsState`:

```ts
  executionOptions: {
    defaultRunProfileId: string
    currentConfigProfileId: string | null
    runProfiles: CodexRunProfile[]
  }
```

- [x] **Step 2: Preserve all supported reasoning override values**

In `src/server/automations/policy.ts`, update `normalizeReasoningEffort()`:

```ts
function normalizeReasoningEffort(value: string | null): CodexRunProfile['reasoningEffort'] | '' {
  return value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : ''
}
```

- [x] **Step 3: Import profile helpers in the automation service**

In `src/server/automations/service.ts`, change the imports:

```ts
import {
  type CodexConfigProfileDefaults,
  DEFAULT_CODEX_RUN_PROFILE_ID,
  mergeCodexRunProfiles,
  normalizeCodexConfigProfiles,
} from '../execution/runProfiles'
```

- [x] **Step 4: Add a service helper to read config profiles**

Add this method inside `AutomationsService`:

```ts
  private async readExecutionOptions(): Promise<AutomationsState['executionOptions']> {
    let currentConfigProfileId: string | null = null
    let configProfiles: CodexRunProfile[] = []
    try {
      const payload = await this.options.bridge?.rpc<{ config?: Record<string, unknown> }>('config/read', {})
      const config = payload?.config
      currentConfigProfileId = typeof config?.profile === 'string' && config.profile.trim()
        ? config.profile.trim()
        : null
      configProfiles = normalizeCodexConfigProfiles(config?.profiles, readCodexConfigProfileDefaults(config))
    } catch {
      currentConfigProfileId = null
      configProfiles = []
    }
    return {
      defaultRunProfileId: currentConfigProfileId || DEFAULT_CODEX_RUN_PROFILE_ID,
      currentConfigProfileId,
      runProfiles: mergeCodexRunProfiles(configProfiles),
    }
  }

function readCodexConfigProfileDefaults(config: Record<string, unknown> | undefined): CodexConfigProfileDefaults {
  return {
    model: typeof config?.model === 'string' ? config.model : '',
    reasoningEffort: readConfigReasoningEffort(config?.model_reasoning_effort),
    sandboxMode: readConfigSandboxMode(config?.sandbox_mode),
    approvalPolicy: readConfigApprovalPolicy(config?.approval_policy),
    networkAccess: readConfigNetworkAccess(config),
  }
}

function readConfigReasoningEffort(value: unknown): CodexConfigProfileDefaults['reasoningEffort'] {
  return value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : null
}

function readConfigSandboxMode(value: unknown): CodexConfigProfileDefaults['sandboxMode'] {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'
    ? value
    : null
}

function readConfigApprovalPolicy(value: unknown): CodexConfigProfileDefaults['approvalPolicy'] {
  return value === 'untrusted' || value === 'on-failure' || value === 'on-request' || value === 'never'
    ? value
    : null
}

function readConfigNetworkAccess(config: Record<string, unknown> | undefined): boolean | null {
  if (config?.network_access === true || config?.networkAccess === true) return true
  if (config?.network_access === false || config?.networkAccess === false) return false
  const sandbox = isRecord(config?.sandbox_workspace_write)
    ? config.sandbox_workspace_write
    : isRecord(config?.sandboxWorkspaceWrite)
      ? config.sandboxWorkspaceWrite
      : null
  if (sandbox?.network_access === true || sandbox?.networkAccess === true) return true
  if (sandbox?.network_access === false || sandbox?.networkAccess === false) return false
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
```

- [x] **Step 5: Include execution options in state**

Update `listState()` in `src/server/automations/service.ts`:

```ts
  async listState(): Promise<AutomationsState> {
    const { definitions, diagnostics, storageRoot } = await this.listDefinitionsWithDiagnostics()
    const executionOptions = await this.readExecutionOptions()
    return {
      storageRoot,
      featureFlags: {
        scheduler: this.options.enableScheduler === true && this.isRunExecutionAvailable(),
        manualRun: this.isRunExecutionAvailable(),
        kanbanProjection: this.kanbanProjection !== null,
        artifactIndexing: this.options.artifactIndexing === true,
      },
      sourceCounts: {
        native: definitions.filter((definition) => definition.source === 'native').length,
        codexui: definitions.filter((definition) => definition.source === 'codexui').length,
      },
      diagnostics,
      definitions,
      executionOptions,
    }
  }
```

- [x] **Step 6: Ensure manual run uses the same profile catalog**

In `src/server/automations/routes.ts`, update the run endpoint:

```ts
  router.post('/:automationId/run', asyncHandler(async (req, res) => {
    assertExecutionAccessMutation(req, csrf, service.getExecutionPolicy())
    const { automationId } = parseAutomationRouteParams(req.params)
    const state = await service.listState()
    res.status(202).json({
      data: await service.runNow(automationId, {
        runProfiles: state.executionOptions.runProfiles,
      }),
    })
  }))
```

This keeps execution consistent with the profile menu without adding a new endpoint or request body.

- [x] **Step 7: Add route tests**

In `src/server/automations/__tests__/routes.test.ts`, add a focused test near the existing `/state` tests. Use a fake bridge:

```ts
const bridge = {
  rpc: async (method: string) => {
    if (method === 'config/read') {
      return {
        config: {
          profile: 'network-coding',
          model: 'gpt-5.4',
          model_reasoning_effort: 'minimal',
          approval_policy: 'on-failure',
          sandbox_mode: 'read-only',
          profiles: {
            'network-coding': {
              model: 'gpt-5.5',
              sandbox_workspace_write: { network_access: true },
            },
          },
        },
      }
    }
    return {}
  },
  dispose: () => {},
  subscribeNotifications: () => () => {},
}
```

Assert:

```ts
expect(state.body.data.executionOptions).toMatchObject({
  defaultRunProfileId: 'network-coding',
  currentConfigProfileId: 'network-coding',
})
expect(state.body.data.executionOptions.runProfiles).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      id: 'network-coding',
      source: 'config',
      model: 'gpt-5.5',
      reasoningEffort: 'minimal',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-failure',
      networkAccess: true,
    }),
  ]),
)
```

- [x] **Step 8: Run targeted tests**

Run:

```bash
pnpm vitest run src/server/automations/__tests__/routes.test.ts src/server/execution/__tests__/runProfiles.test.ts
```

Expected: all tests pass.

- [x] **Step 9: Commit**

```bash
git add src/types/automations.ts src/server/automations/policy.ts src/server/automations/service.ts src/server/automations/routes.ts src/server/automations/__tests__/routes.test.ts
git commit -m "feat: expose automation run profile options"
```

---

### Task 3: Move Execution Settings Into Advanced As Selects

**Files:**
- Modify: `src/composables/useAutomations.ts`
- Modify: `src/components/automations/AutomationsPage.vue`

- [ ] **Step 1: Make empty drafts prefer the state default profile**

In `src/composables/useAutomations.ts`, leave `createEmptyDraft()` storage-compatible by defaulting to an empty string, but add a helper that can apply the state default after load:

```ts
function applyDefaultRunProfileToDraft(): void {
  if (draft.value.runProfileId.trim()) return
  draft.value.runProfileId = state.value.executionOptions.defaultRunProfileId
}
```

Call it after `loadAll()` finishes and in `startCreate()`.

- [ ] **Step 2: Remove model/reasoning from the primary form grid**

In `src/components/automations/AutomationsPage.vue`, delete these labels from the main `.automations-field-grid`:

```vue
<label class="automations-field">
  <span>Model</span>
  <select v-model="draft.model">
    <option v-for="option in modelSelectOptions" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</label>
<label class="automations-field">
  <span>Reasoning effort</span>
  <select v-model="draft.reasoningEffort">
    <option v-for="option in reasoningEffortSelectOptions" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</label>
```

- [ ] **Step 3: Replace the Advanced free-text profile input with select controls**

In the `<details class="automations-advanced">` content, replace the current `Run profile id` input with:

```vue
<div class="automations-execution-settings" aria-label="Automation execution settings">
  <label class="automations-field">
    <span>Run profile</span>
    <select v-model="draft.runProfileId">
      <option
        v-for="profile in runProfileOptions"
        :key="profile.value"
        :value="profile.value"
      >
        {{ profile.label }}
      </option>
    </select>
    <small class="automations-field-help">{{ selectedRunProfileHelp }}</small>
  </label>

  <label class="automations-field">
    <span>Model override</span>
    <select v-model="draft.model">
      <option v-for="option in modelSelectOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </label>

  <label class="automations-field">
    <span>Reasoning override</span>
    <select v-model="draft.reasoningEffort">
      <option v-for="option in reasoningEffortSelectOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </label>
</div>
```

Ensure `baseReasoningEffortOptions` includes every supported Codex reasoning value:

```ts
const baseReasoningEffortOptions = [
  { value: '', label: 'Default reasoning' },
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
] as const
```

- [ ] **Step 4: Add computed options and selected-profile summary**

In `<script setup>`, add:

```ts
const runProfileOptions = computed(() =>
  state.value.executionOptions.runProfiles.map((profile) => ({
    value: profile.id,
    label: profile.source === 'config'
      ? `${profile.name} (${profile.id})`
      : profile.name,
  })),
)

const selectedRunProfile = computed(() => {
  const requested = draft.value.runProfileId.trim()
  return state.value.executionOptions.runProfiles.find((profile) => profile.id === requested)
    ?? state.value.executionOptions.runProfiles.find((profile) => profile.id === state.value.executionOptions.defaultRunProfileId)
    ?? state.value.executionOptions.runProfiles[0]
    ?? null
})

const selectedRunProfileHelp = computed(() => {
  const profile = selectedRunProfile.value
  if (!profile) return 'No run profiles are available.'
  const model = draft.value.model.trim() || profile.model.trim() || 'default model'
  const reasoning = draft.value.reasoningEffort.trim() || profile.reasoningEffort || 'default reasoning'
  const network = profile.networkAccess ? 'network on' : 'network off'
  return `${profile.sandboxMode}, ${profile.approvalPolicy}, ${network}, ${model}, ${reasoning}`
})
```

Use `ensureOption()` for models/reasoning exactly as today so existing unknown values remain selectable.

- [ ] **Step 5: Open Advanced by default**

Change:

```vue
<details class="automations-advanced">
```

to:

```vue
<details class="automations-advanced" open>
```

This satisfies "visible in the advanced tab" while keeping the main editor focused on name, target, prompt, and schedule.

- [ ] **Step 6: Update CSS**

In `AutomationsPage.vue`, add:

```css
.automations-execution-settings {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

@media (max-width: 720px) {
  .automations-execution-settings {
    grid-template-columns: 1fr;
  }
}
```

Keep the existing mobile `font-size: 16px` form-control rule so select focus does not reintroduce mobile zoom.

- [ ] **Step 7: Run frontend tests/build**

Run:

```bash
pnpm vitest run src/utils/automationDisplay.test.ts src/composables/useAutomations.test.ts
pnpm run build:frontend
```

Expected: tests and build pass.

- [ ] **Step 8: Commit**

```bash
git add src/composables/useAutomations.ts src/components/automations/AutomationsPage.vue
git commit -m "feat: make automation execution settings selectable"
```

---

### Task 4: Document And Browser-Verify The UI

**Files:**
- Modify: `tests.md`

- [ ] **Step 1: Update manual test documentation**

Append/update a section in `tests.md`:

```md
## Automations Advanced Execution Settings

### Prerequisites
- Dev server running from the target worktree.
- At least one Codex `config.toml` profile under `[profiles.<name>]`, or use the built-in profiles as fallback.

### Steps
1. Open `/automations`.
2. Select an existing automation or create a new automation.
3. Confirm Advanced details is expanded.
4. Change Run profile from the dropdown.
5. Change Model override and Reasoning override from dropdowns.
6. Save the automation.
7. Reload the page and reselect the automation.

### Expected Results
- Run profile is a menu, not a free-text input.
- Config profiles from `config.toml` appear in the menu with their profile IDs.
- Model and reasoning controls are editable in Advanced.
- Saved run profile, model, and reasoning choices persist after reload.
- Mobile select focus does not zoom or jump back to the top of the page.

### Light Theme Result
- Verified controls are readable, aligned, and do not overflow.

### Dark Theme Result
- Verified controls use dark input surfaces and readable text.

### Rollback/Cleanup
- Revert the saved automation changes or delete the test automation.
```

- [ ] **Step 2: Restart the requested dev server before browser verification**

If the user still wants port `5173`, run from the final target worktree:

```bash
fuser -k 5173/tcp || true
pnpm run dev -- --host 0.0.0.0 --port 5173
```

Expected: Vite serves the worktree code at `http://127.0.0.1:5173`.

- [ ] **Step 3: Run Playwright checks**

Use CJS Playwright from the repo root. Verify:

- Desktop light: `/automations` shows Advanced open, run profile select exists, no text input for Run profile id.
- Desktop dark: same checks after setting dark mode.
- Mobile 375x812: scroll to Advanced, tap each select, no page reset to top, no horizontal overflow.

Save screenshots:

```text
output/playwright/automation-advanced-execution-light.png
output/playwright/automation-advanced-execution-dark.png
output/playwright/automation-advanced-execution-mobile.png
```

- [ ] **Step 4: Run final static checks**

Run:

```bash
pnpm vitest run src/server/execution/__tests__/runProfiles.test.ts src/server/automations/__tests__/routes.test.ts src/utils/automationDisplay.test.ts src/composables/useAutomations.test.ts
pnpm run build:frontend
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit docs and any verification harness changes**

```bash
git add tests.md output/playwright
git commit -m "docs: add automation execution settings verification"
```

Do not commit screenshots if this repo normally leaves `output/playwright` untracked; in that case only commit `tests.md` and report screenshot paths.

---

## Review Notes

- This plan intentionally keeps `runProfileId` as the persisted field. It changes the input method and available choices, not the sidecar schema.
- Config profile IDs from Codex `config.toml` are normalized from `config/read` `profiles`. The official schema uses top-level `profiles` and `profile`, with profile fields like `model`, `model_reasoning_effort`, `sandbox_mode`, and `approval_policy`.
- Built-in run profiles remain as fallback choices so existing automations with `workspace-coding`, `read-only-planning`, or `workspace-coding-network` continue to work even when no config profiles exist.
- If a config profile uses the same ID as a built-in profile, the config profile wins. That matches the user expectation that actual configured profiles should drive the menu.
- The model/reasoning overrides still take precedence over profile defaults at execution time, matching current automation policy behavior.
- A later enhancement could reuse the same config-profile catalog in Kanban metadata, but this plan deliberately limits scope to Automations.
