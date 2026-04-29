# Floating Plan Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating, collapsible active-plan dock that shows the selected thread's latest plan updates while preserving existing inline plan cards in chat history.

**Architecture:** Keep plan data single-sourced from the existing reactive `messages` array that already combines persisted messages with live `turn/plan/updated` and `item/plan/delta` state. Extract the current plan card into a reusable `PlanCard.vue`, use it both inline and inside a new `FloatingPlanDock.vue`, and derive the active dock message with a pure utility that prefers live/in-progress plans over completed historical plans.

**Tech Stack:** Vue 3 SFCs, TypeScript, Tailwind via `@apply`, Vitest, existing Codex app-server bridge notifications.

**Branch Context:**
- Dev implementation branch: `feature/floating-plan-dock-dev`
- Worktree: `/home/drj/projects/codexUI-floating-plan-dock-dev`
- `DEV_BASE`: `6da96ce451f669b977931b852e13fdef052c1300`
- Dev PR target: `origin/dev`
- Later upstream branch: `feature/floating-plan-dock`

---

## Requirements Coverage

- Preserve current inline plan rendering in chat history: Task 3 replaces inline markup with `PlanCard` without removing inline placement.
- Floating dock: Task 4 adds `FloatingPlanDock.vue` and renders it from `ThreadConversation.vue`.
- Existing reactive state only: Task 2 derives active plan from `props.messages`; no bridge or subscription changes.
- Prefer live/in-progress: Task 1 adds `selectActivePlanMessage()` with unit coverage.
- Persist collapse state: Task 4 stores dock collapse state in `localStorage`.
- Desktop floating and mobile bottom sheet: Task 5 adds responsive global CSS.
- Preserve `Implement plan`: Task 3 and Task 4 emit the existing `implementPlan` event path.
- Dark theme: Task 5 puts decisive overrides in `src/style.css`.
- Manual docs and verification: Task 6 updates `tests.md`; Task 7 runs build and unit tests.

## Files

- Create: `src/components/content/planUtils.ts`
  - Shared plan parsing, status icon, implement-action predicate, and active-plan selection helpers.
- Create: `src/components/content/planUtils.test.ts`
  - Pure Vitest coverage for active plan selection and implement-action behavior.
- Create: `src/components/content/PlanCard.vue`
  - Reusable plan card component for inline chat cards and floating dock content.
- Create: `src/components/content/FloatingPlanDock.vue`
  - Collapsible responsive dock that renders one active `UiMessage` plan.
- Modify: `src/components/content/ThreadConversation.vue`
  - Import `PlanCard`, `FloatingPlanDock`, and plan utilities.
  - Replace existing inline plan markup with `PlanCard`.
  - Derive `activeFloatingPlanMessage` from `props.messages`.
  - Render the floating dock without changing message state or subscriptions.
- Modify: `src/style.css`
  - Move shared plan-card dark-theme coverage here as needed.
  - Add floating dock desktop and mobile styles.
- Modify: `tests.md`
  - Add manual checks for light, dark, live updates, collapse persistence, and mobile behavior.

---

## Task 1: Extract Shared Plan Utilities

**Files:**
- Create: `src/components/content/planUtils.ts`
- Create: `src/components/content/planUtils.test.ts`
- Modify: `src/components/content/ThreadConversation.vue`

- [ ] **Step 1: Create the shared utility module**

Create `src/components/content/planUtils.ts` with these exports:

```ts
import type { UiMessage, UiPlanStep } from '../../types/codex'

export type ReadablePlanData = {
  explanation: string
  steps: UiPlanStep[]
}

export function parsePlanFromMessageText(text: string): ReadablePlanData | null {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return null

  const steps: UiPlanStep[] = []
  const explanationLines: string[] = []

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (steps.length === 0) explanationLines.push('')
      continue
    }

    const match = trimmed.match(/^[-*]\s+\[([ xX~>|-])\]\s+(.+)$/)
    if (match) {
      const marker = (match[1] ?? ' ').toLowerCase()
      let status: UiPlanStep['status'] = 'pending'
      if (marker === 'x') status = 'completed'
      if (marker === '~' || marker === '>' || marker === '-') status = 'inProgress'
      const step = match[2]?.trim() ?? ''
      if (step) steps.push({ step, status })
      continue
    }

    explanationLines.push(trimmed)
  }

  if (steps.length === 0) return null
  return {
    explanation: explanationLines.join('\n').trim(),
    steps,
  }
}

export function readPlanData(message: UiMessage): ReadablePlanData | null {
  if (message.plan && message.plan.steps.length > 0) {
    return {
      explanation: message.plan.explanation?.trim() ?? '',
      steps: message.plan.steps,
    }
  }
  return parsePlanFromMessageText(message.text)
}

export function isPlanMessage(message: UiMessage): boolean {
  return message.messageType === 'plan' || message.messageType === 'plan.live'
}

export function readPlanExplanation(message: UiMessage): string {
  return readPlanData(message)?.explanation ?? ''
}

export function readPlanSteps(message: UiMessage): UiPlanStep[] {
  return readPlanData(message)?.steps ?? []
}

export function planStepStatusIcon(status: UiPlanStep['status']): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'inProgress':
      return '•'
    default:
      return '○'
  }
}

export function showImplementPlanButton(message: UiMessage): boolean {
  return isPlanMessage(message)
    && message.messageType !== 'plan.live'
    && message.role === 'assistant'
    && Boolean(message.turnId?.trim())
}

export function selectActivePlanMessage(messages: UiMessage[]): UiMessage | null {
  const planMessages = messages.filter(isPlanMessage)
  const livePlan = [...planMessages]
    .reverse()
    .find((message) => message.messageType === 'plan.live' || message.plan?.isStreaming === true)
  if (livePlan) return livePlan
  return [...planMessages].reverse().find((message) => message.role === 'assistant') ?? null
}

export function planStepCopyMarker(status: UiPlanStep['status']): string {
  switch (status) {
    case 'completed':
      return '[x]'
    case 'inProgress':
      return '[~]'
    default:
      return '[ ]'
  }
}

export function buildPlanCopyText(message: UiMessage): string {
  const planData = readPlanData(message)
  if (!planData) return ''
  const sections: string[] = []
  if (planData.explanation.trim()) sections.push(planData.explanation.trim())
  if (planData.steps.length > 0) {
    sections.push(planData.steps.map((step) => `- ${planStepCopyMarker(step.status)} ${step.step}`.trim()).join('\n'))
  }
  return sections.join('\n\n').trim()
}
```

- [ ] **Step 2: Add utility tests**

Create `src/components/content/planUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../../types/codex'
import {
  buildPlanCopyText,
  parsePlanFromMessageText,
  selectActivePlanMessage,
  showImplementPlanButton,
} from './planUtils'

function planMessage(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: 'plan-1',
    role: 'assistant',
    text: '- [ ] One',
    messageType: 'plan',
    turnId: 'turn-1',
    ...overrides,
  }
}

describe('planUtils', () => {
  it('parses checkbox plan text into explanation and steps', () => {
    const parsed = parsePlanFromMessageText('Intro\n\n- [x] Done\n- [~] Working\n- [ ] Waiting')
    expect(parsed).toEqual({
      explanation: 'Intro',
      steps: [
        { step: 'Done', status: 'completed' },
        { step: 'Working', status: 'inProgress' },
        { step: 'Waiting', status: 'pending' },
      ],
    })
  })

  it('prefers live plan messages over newer completed plan messages', () => {
    const live = planMessage({
      id: 'live',
      messageType: 'plan.live',
      text: '- [~] Live',
      plan: { steps: [{ step: 'Live', status: 'inProgress' }], isStreaming: true },
    })
    const completed = planMessage({ id: 'completed', text: '- [x] Complete' })
    expect(selectActivePlanMessage([live, completed])?.id).toBe('live')
  })

  it('selects the latest completed assistant plan when no live plan exists', () => {
    const first = planMessage({ id: 'first', text: '- [x] First' })
    const second = planMessage({ id: 'second', text: '- [x] Second' })
    expect(selectActivePlanMessage([first, second])?.id).toBe('second')
  })

  it('hides implement action for live plans and shows it for completed assistant plans', () => {
    expect(showImplementPlanButton(planMessage({ messageType: 'plan.live' }))).toBe(false)
    expect(showImplementPlanButton(planMessage({ messageType: 'plan', turnId: 'turn-1' }))).toBe(true)
  })

  it('builds copy text from structured plan data', () => {
    const text = buildPlanCopyText(planMessage({
      text: '',
      plan: {
        explanation: 'Do this carefully',
        steps: [
          { step: 'First', status: 'pending' },
          { step: 'Second', status: 'completed' },
        ],
      },
    }))
    expect(text).toBe('Do this carefully\n\n- [ ] First\n- [x] Second')
  })
})
```

- [ ] **Step 3: Run the focused unit test and verify it passes**

Run:

```bash
pnpm vitest run src/components/content/planUtils.test.ts
```

Expected: `planUtils.test.ts` passes.

- [ ] **Step 4: Commit Task 1**

```bash
git add src/components/content/planUtils.ts src/components/content/planUtils.test.ts
git commit -m "test: add shared plan utilities"
```

---

## Task 2: Create Reusable `PlanCard.vue`

**Files:**
- Create: `src/components/content/PlanCard.vue`
- Modify: `src/components/content/ThreadConversation.vue`

- [ ] **Step 1: Create `PlanCard.vue`**

Create `src/components/content/PlanCard.vue`:

```vue
<template>
  <div class="plan-card" :data-streaming="message.messageType === 'plan.live'">
    <div class="plan-card-header">
      <p class="plan-card-title">{{ title }}</p>
      <span v-if="message.messageType === 'plan.live'" class="plan-card-badge">Updating</span>
    </div>
    <div
      v-if="planExplanation"
      class="plan-card-explanation plan-card-markdown"
      v-html="renderMarkdownBlocksAsHtml(planExplanation)"
    />
    <ol v-if="planSteps.length > 0" class="plan-step-list">
      <li
        v-for="(step, stepIndex) in planSteps"
        :key="`${message.id}:plan-step:${stepIndex}`"
        class="plan-step-item"
        :data-status="step.status"
      >
        <span class="plan-step-status" :data-status="step.status">{{ planStepStatusIcon(step.status) }}</span>
        <div class="plan-step-text plan-card-markdown" v-html="renderMarkdownBlocksAsHtml(step.step)" />
      </li>
    </ol>
    <div v-else class="plan-card-markdown" v-html="renderMarkdownBlocksAsHtml(message.text)" />
    <div v-if="showImplementPlanButton(message)" class="plan-card-actions">
      <button
        type="button"
        class="plan-card-implement-button"
        @click="$emit('implementPlan', message)"
      >
        Implement plan
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { UiMessage } from '../../types/codex'
import {
  planStepStatusIcon,
  readPlanExplanation,
  readPlanSteps,
  showImplementPlanButton,
} from './planUtils'

const props = withDefaults(defineProps<{
  message: UiMessage
  title?: string
  renderMarkdownBlocksAsHtml: (text: string) => string
}>(), {
  title: 'Plan',
})

defineEmits<{
  implementPlan: [message: UiMessage]
}>()

const planExplanation = computed(() => readPlanExplanation(props.message))
const planSteps = computed(() => readPlanSteps(props.message))
</script>
```

- [ ] **Step 2: Import and use `PlanCard` inline**

In `src/components/content/ThreadConversation.vue`, replace the current inline `<div v-else-if="isPlanMessage(message)" class="plan-card"...>` block with:

```vue
<PlanCard
  v-else-if="isPlanMessage(message)"
  :message="message"
  :render-markdown-blocks-as-html="renderMarkdownBlocksAsHtml"
  @implement-plan="implementPlan"
/>
```

Add imports near the existing component imports:

```ts
import PlanCard from './PlanCard.vue'
import {
  buildPlanCopyText,
  isPlanMessage,
  readPlanData,
} from './planUtils'
```

Remove the local `parsePlanFromMessageText`, `readPlanData`, `isPlanMessage`, `showImplementPlanButton`, `readPlanExplanation`, `readPlanSteps`, `planStepStatusIcon`, `planStepCopyMarker`, and `buildPlanCopyText` functions from `ThreadConversation.vue` once their replacements are imported.

- [ ] **Step 3: Run focused type/build check**

Run:

```bash
pnpm run build:frontend
```

Expected: Vue type-checking and Vite build pass. If styles still live in `ThreadConversation.vue`, visual output should match current inline plan cards.

- [ ] **Step 4: Commit Task 2**

```bash
git add src/components/content/PlanCard.vue src/components/content/ThreadConversation.vue
git commit -m "refactor: extract reusable plan card"
```

---

## Task 3: Add `FloatingPlanDock.vue`

**Files:**
- Create: `src/components/content/FloatingPlanDock.vue`
- Modify: `src/components/content/ThreadConversation.vue`

- [ ] **Step 1: Create the dock component**

Create `src/components/content/FloatingPlanDock.vue`:

```vue
<template>
  <aside
    v-if="message"
    class="floating-plan-dock"
    :class="{ 'is-collapsed': isCollapsed }"
    aria-label="Active plan"
  >
    <button
      type="button"
      class="floating-plan-dock-toggle"
      :aria-expanded="String(!isCollapsed)"
      @click="toggleCollapsed"
    >
      <span class="floating-plan-dock-title">Active plan</span>
      <span v-if="isLivePlan" class="floating-plan-dock-live">Updating</span>
      <span class="floating-plan-dock-chevron" aria-hidden="true">{{ isCollapsed ? '▲' : '▼' }}</span>
    </button>
    <div v-if="!isCollapsed" class="floating-plan-dock-body">
      <PlanCard
        :message="message"
        title="Active plan"
        :render-markdown-blocks-as-html="renderMarkdownBlocksAsHtml"
        @implement-plan="$emit('implementPlan', $event)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { UiMessage } from '../../types/codex'
import PlanCard from './PlanCard.vue'

const STORAGE_KEY = 'codexapp:floating-plan-dock:collapsed'

const props = defineProps<{
  message: UiMessage | null
  renderMarkdownBlocksAsHtml: (text: string) => string
}>()

defineEmits<{
  implementPlan: [message: UiMessage]
}>()

const isCollapsed = ref(false)
const isLivePlan = computed(() => props.message?.messageType === 'plan.live' || props.message?.plan?.isStreaming === true)

function readCollapsedFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsedToStorage(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // Ignore storage failures so private/quota-limited browsers can still use the dock.
  }
}

function toggleCollapsed(): void {
  isCollapsed.value = !isCollapsed.value
}

onMounted(() => {
  isCollapsed.value = readCollapsedFromStorage()
})

watch(isCollapsed, (value) => writeCollapsedToStorage(value))
</script>
```

- [ ] **Step 2: Wire the dock into `ThreadConversation.vue`**

In `ThreadConversation.vue`, import:

```ts
import FloatingPlanDock from './FloatingPlanDock.vue'
import { selectActivePlanMessage } from './planUtils'
```

Add a computed value after `hiddenGroupedCommandIds` or near related message-derived computed state:

```ts
const activeFloatingPlanMessage = computed(() => selectActivePlanMessage(props.messages))
```

Render the dock near the end of the template, outside the scroll list but still inside the component:

```vue
<FloatingPlanDock
  :message="activeFloatingPlanMessage"
  :render-markdown-blocks-as-html="renderMarkdownBlocksAsHtml"
  @implement-plan="implementPlan"
/>
```

Do not add any app-server subscription, websocket listener, or new state store. The dock must update because `props.messages` changes.

- [ ] **Step 3: Verify implement action still follows the existing path**

Clicking `Implement plan` from the dock should call the same `implementPlan(message)` function used by inline cards, which emits:

```ts
emit('implementPlan', { turnId })
```

Do not add a second implementation command builder.

- [ ] **Step 4: Commit Task 3**

```bash
git add src/components/content/FloatingPlanDock.vue src/components/content/ThreadConversation.vue
git commit -m "feat: add floating active plan dock"
```

---

## Task 4: Move Plan Card Styles And Add Dock Styles

**Files:**
- Modify: `src/components/content/ThreadConversation.vue`
- Modify: `src/style.css`

- [ ] **Step 1: Move reusable plan card styles to global CSS**

Move the existing `.plan-card`, `.plan-card-*`, and `.plan-step-*` rules from the scoped style section of `ThreadConversation.vue` into `src/style.css`, because `PlanCard.vue` is used by both inline chat and the floating dock.

Keep the class names unchanged:

```css
.plan-card { ... }
.plan-card-header { ... }
.plan-card-title { ... }
.plan-card-badge { ... }
.plan-card-explanation { ... }
.plan-card-markdown { ... }
.plan-step-list { ... }
.plan-step-item { ... }
.plan-step-status { ... }
.plan-card-actions { ... }
.plan-card-implement-button { ... }
```

When moving selectors that currently use Vue `:deep(...)`, convert them to normal global descendants:

```css
.plan-card-markdown .message-text,
.plan-card-markdown .message-heading,
.plan-card-markdown .message-blockquote,
.plan-card-markdown .message-list,
.plan-card-markdown .message-table-wrap,
.plan-card-markdown .message-code-block,
.plan-card-markdown .message-divider {
  @apply m-0;
}
```

- [ ] **Step 2: Add desktop dock layout**

Add these global rules to `src/style.css`:

```css
.floating-plan-dock {
  @apply fixed right-5 bottom-24 z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white/95 text-slate-900 shadow-2xl shadow-slate-900/15 backdrop-blur;
}

.floating-plan-dock-toggle {
  @apply flex min-h-12 w-full items-center gap-2 border-0 bg-sky-50 px-4 py-3 text-left text-sm font-semibold text-sky-950 transition hover:bg-sky-100;
}

.floating-plan-dock-title {
  @apply min-w-0 flex-1 truncate;
}

.floating-plan-dock-live {
  @apply inline-flex shrink-0 rounded-full bg-sky-200 px-2 py-0.5 text-[11px] font-medium leading-4 text-sky-950;
}

.floating-plan-dock-chevron {
  @apply shrink-0 text-xs text-sky-900;
}

.floating-plan-dock-body {
  @apply max-h-[min(52vh,520px)] overflow-y-auto p-3;
}

.floating-plan-dock .plan-card {
  @apply max-w-none border-0 bg-transparent p-0 shadow-none;
}

.floating-plan-dock.is-collapsed {
  @apply w-[min(320px,calc(100vw-2rem))];
}
```

- [ ] **Step 3: Add mobile bottom-sheet behavior**

Add:

```css
@media (max-width: 767px) {
  .floating-plan-dock {
    @apply inset-x-3 bottom-3 w-auto rounded-2xl;
  }

  .floating-plan-dock-body {
    @apply max-h-[45vh] p-3;
  }
}
```

- [ ] **Step 4: Add decisive dark-theme styles**

Extend existing dark plan-card rules and add dock-specific rules in `src/style.css`:

```css
:root.dark .floating-plan-dock {
  @apply border-sky-900/70 bg-slate-950/95 text-slate-100 shadow-black/35;
}

:root.dark .floating-plan-dock-toggle {
  @apply bg-slate-900 text-sky-100 hover:bg-slate-800;
}

:root.dark .floating-plan-dock-live {
  @apply bg-sky-900/80 text-sky-100;
}

:root.dark .floating-plan-dock-chevron {
  @apply text-sky-200;
}
```

Ensure the existing dark selectors for `.plan-card`, `.plan-card-title`, `.plan-card-badge`, `.plan-card-explanation`, `.plan-card-markdown`, `.plan-step-item`, `.plan-step-status`, and `.plan-card-implement-button` still apply after moving the base styles.

- [ ] **Step 5: Run frontend build**

Run:

```bash
pnpm run build:frontend
```

Expected: build passes with no CSS or Vue type errors.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/components/content/ThreadConversation.vue src/style.css
git commit -m "style: add responsive plan dock styling"
```

---

## Task 5: Codex.app Parity And Browser Verification

**Files:**
- Modify only if verification finds a fixable mismatch:
  - `src/components/content/FloatingPlanDock.vue`
  - `src/components/content/PlanCard.vue`
  - `src/style.css`

- [ ] **Step 1: Inspect Codex.app or document fallback**

Follow `.agents/skills/codex-app-parity/SKILL.md`.

First check whether Codex.app is available on this host:

```bash
test -d /Applications/Codex.app && echo "Codex.app available" || echo "Codex.app unavailable on this host"
```

If available, inspect the app bundle and capture the closest reference UI for plan/status surfaces. If unavailable, document the fallback explicitly in the final report and use the current web inline plan card as the local parity baseline.

- [ ] **Step 2: Capture web-before evidence before final UI fixes**

Only when Playwright/browser verification is requested or available for this implementation stage, start the dev server:

```bash
pnpm run dev -- --host 0.0.0.0 --port 4173
```

Capture a web-before screenshot for a thread with a plan card:

```text
output/playwright/floating-plan-dock-web-before.png
```

- [ ] **Step 3: Verify the dock manually in the browser**

Check:

1. A completed historical plan card still appears inline in chat history.
2. The floating dock appears for the selected thread when a plan message exists.
3. A live `plan.live` message shows the `Updating` badge in the dock.
4. When both live and completed plans exist, the dock displays the live plan.
5. Clicking `Implement plan` from a completed dock plan sends the same implementation prompt path as inline cards.
6. Collapse state persists after refresh.
7. Mobile viewport (`375x812`) shows the dock as a bottom sheet and does not cover the composer in an unusable way.

- [ ] **Step 4: Capture web-after evidence if Playwright/browser verification is used**

Save:

```text
output/playwright/floating-plan-dock-light.png
output/playwright/floating-plan-dock-dark.png
output/playwright/floating-plan-dock-mobile.png
```

- [ ] **Step 5: Commit any verification-driven fixes**

Only if code changed:

```bash
git add src/components/content/FloatingPlanDock.vue src/components/content/PlanCard.vue src/style.css
git commit -m "fix: polish floating plan dock behavior"
```

---

## Task 6: Update Manual Test Documentation

**Files:**
- Modify: `tests.md`

- [ ] **Step 1: Append a new `tests.md` section**

Append this section to `tests.md`:

```md
### Floating active plan dock

Floating active plan dock shows the selected thread's latest plan without removing inline plan cards from chat history.

#### Prerequisites/setup

1. Start the app with `pnpm run dev -- --host 0.0.0.0 --port 4173`.
2. Open `http://127.0.0.1:4173`.
3. Use a thread that contains at least one completed plan card, or send a plan-mode prompt that produces a plan.
4. For live-update behavior, use a prompt/model combination that emits `turn/plan/updated` or `item/plan/delta` while the turn is in progress.

#### Steps

1. Open a thread with a completed plan card.
2. Confirm the original inline plan card remains visible in chat history.
3. Confirm the floating dock appears and displays the latest plan for the selected thread.
4. Collapse the dock, refresh the page, and confirm it remains collapsed.
5. Expand the dock, refresh the page, and confirm it remains expanded.
6. Switch to dark theme and confirm the dock, plan text, step rows, status badges, and `Implement plan` button remain readable.
7. Start a new live plan turn and confirm the dock switches to the live/in-progress plan and shows `Updating`.
8. Complete the turn and confirm the inline completed plan remains in chat history.
9. On a `375x812` viewport, confirm the dock behaves like a bottom sheet and does not make the composer unusable.
10. If the dock displays a completed plan with an `Implement plan` button, click it and confirm the app sends the existing `Implement` follow-up in default mode.

#### Expected results

- Inline plan cards are unchanged in chat history.
- The dock derives from the selected thread's existing message state and updates during live plan notifications.
- Live/in-progress plans take precedence over completed historical plans.
- Collapse/expand state persists through reloads via `localStorage`.
- Light and dark themes both have readable contrast.
- Mobile layout keeps the dock reachable without blocking normal chat interaction.
- `Implement plan` uses the existing action path.

#### Rollback/cleanup notes

- Clear `localStorage` key `codexapp:floating-plan-dock:collapsed` to reset dock collapse state.
- Stop the dev server when verification is complete.
```

- [ ] **Step 2: Commit Task 6**

```bash
git add tests.md
git commit -m "docs: add floating plan dock test steps"
```

---

## Task 7: Final Verification And Dev PR Prep

**Files:**
- No new files expected unless verification reveals needed fixes.

- [ ] **Step 1: Run required verification**

Run:

```bash
pnpm run build
pnpm run test:unit
```

Expected:

- `pnpm run build` passes `build:frontend` and `build:cli`.
- `pnpm run test:unit` passes all Vitest suites.

- [ ] **Step 2: Check final diff against `dev`**

Run:

```bash
git status --short
git diff --stat dev...HEAD
git diff --check
```

Expected:

- No unstaged changes except intentional artifacts, if any.
- Diff contains only the plan dock implementation, tests, and `tests.md` docs.
- `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Push the dev feature branch**

Run:

```bash
git push -u origin feature/floating-plan-dock-dev
```

- [ ] **Step 4: Open the dev integration PR**

Open PR:

```text
feature/floating-plan-dock-dev -> origin/dev
```

Include in the PR body:

```text
DEV_BASE: 6da96ce451f669b977931b852e13fdef052c1300

Verification:
- pnpm run build
- pnpm run test:unit
- Light theme manual check
- Dark theme manual check
- Mobile viewport manual check
- Collapse persistence check
```

Do not open the upstream `main` PR from `feature/floating-plan-dock-dev`.

---

## Later Upstream Porting Step

After the dev PR is merged and the merged `dev` state is tested, create the clean upstream branch from updated `main`:

```bash
git fetch upstream main --prune
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c feature/floating-plan-dock main
git cherry-pick 6da96ce451f669b977931b852e13fdef052c1300..feature/floating-plan-dock-dev
```

Resolve conflicts intentionally, run upstream-appropriate verification, then open:

```text
feature/floating-plan-dock -> upstream/main
```

Do not include unrelated `dev` integration commits in the upstream PR.

---

## Self-Review Checklist

- [ ] Spec coverage: all 10 requested implementation points map to tasks above.
- [ ] No new app-server subscription is introduced.
- [ ] Inline plan card rendering remains in chat history.
- [ ] Floating dock derives from existing `props.messages`.
- [ ] Active plan selection prefers live/in-progress plan messages.
- [ ] Collapse state persists in `localStorage`.
- [ ] Desktop and mobile CSS are explicitly covered.
- [ ] Dark-theme CSS lives in `src/style.css`.
- [ ] `Implement plan` uses the existing `ThreadConversation.vue` emit path.
- [ ] `tests.md` update includes light, dark, live update, persistence, and mobile checks.
- [ ] Final verification includes `pnpm run build` and `pnpm run test:unit`.
