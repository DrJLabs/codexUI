# Automations Phase 4 Risk Checklist

- Loading: `loadAll()` shows loading state and does not discard a pending route `threadId` prefill while the request is in flight.
- Empty state: no definitions renders a create draft, with thread prefill applied when present.
- Diagnostics: invalid native records and sidecar sanitization diagnostics render with message and path, and long paths wrap.
- Stale CSRF: protected gateway mutations refresh one stale Automations CSRF token and retry once.
- Destructive delete: UI calls `deleteAutomation(id, { removeNative: true })`; button and confirmation copy both state native folder removal.
- Mutation errors: save/pause/resume/delete failures are shown separately from load errors.
- Route shell: Automations is excluded from thread composer/export/sidebar context behavior like other non-thread routes.
- Legacy fallback: thread menu still exposes `Quick edit automation...` and opens the existing dialog.
- Long content: automation IDs, thread IDs, RRULEs, native paths, and sidecar paths wrap without overflowing list/editor surfaces.
- Light/dark: route surfaces, table rows, inputs, buttons, diagnostics, and danger states have explicit dark-theme styling.
