# Automations Phase 4 Frontend Plan

## Framework, Router, Data

- Vue 3 Composition API.
- Vue Router hash route `#/automations`.
- Data source is the Phase 3 `/codex-api/automations` API through `src/api/automationsGateway.ts`.

## Component Boundaries

- `src/api/automationsGateway.ts` owns HTTP, response unwrapping, API errors, encoded IDs, and Automations CSRF retry.
- `src/composables/useAutomations.ts` owns server state, templates, diagnostics, selected definition, draft form state, pending `threadId` prefill, and CRUD actions.
- `src/components/automations/AutomationsPage.vue` owns route rendering, query watching, dense list/editor layout, delete confirmation copy, and button wiring.
- `src/App.vue` owns app-shell route selection, header title/icon state, primary sidebar navigation, and thread menu shortcut handling.
- `src/components/sidebar/SidebarThreadTree.vue` keeps the legacy quick-edit dialog reachable while routing the main automation action to the shared editor.

## Data Flow

1. App shell renders `AutomationsPage` for route name `automations`.
2. `AutomationsPage` watches `route.query.threadId` immediately and calls `applyThreadPrefill(threadId)`.
3. `loadAll()` fetches state and templates. If a prefill arrived before load completed, the composable selects the matching automation or starts a create draft for that thread.
4. Save creates or patches through the gateway, reloads state, and keeps the affected automation selected when possible.
5. Pause/resume/delete mutate through the gateway and reload state.
6. Delete uses `deleteAutomation(id, { removeNative: true })` and the UI confirmation states that the native automation folder is removed.

## Routing

- `src/router/index.ts` registers `{ path: '/automations', name: 'automations' }`.
- `SidebarPrimaryNav.vue` emits `navigate-automations`, `navigate-skills`, and `navigate-kanban` from the controlled primary nav rows.
- `SidebarThreadTree.vue` emits `manage-automation` from the thread menu; `App.vue` routes to `{ name: 'automations', query: { threadId } }`.

## Loading And Errors

- Loading state is route-local and shown in the list area.
- API load errors stay in `errorMessage` and show a retry action.
- Mutation errors stay in `mutationError` and do not replace loaded state.
- Empty definitions still render the create editor so `#/automations?threadId=...` has a usable target.
