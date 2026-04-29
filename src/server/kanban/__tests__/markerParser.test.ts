import { describe, expect, it } from 'vitest'
import { parseKanbanMarkers } from '../markerParser'

describe('parseKanbanMarkers', () => {
  it('extracts create and update fenced markers from clean result text', () => {
    const result = parseKanbanMarkers(`Normal result text.

\`\`\`kanban:create
{"title":"Follow-up task","description":"Check mobile layout","priority":"high","labels":[{"name":"ui","color":"blue"}]}
\`\`\`

\`\`\`kanban:update
{"taskId":"task_123","patch":{"blockedReason":"Needs credentials"}}
\`\`\``)

    expect(result.cleanText).toBe('Normal result text.')
    expect(result.markers).toEqual([
      {
        type: 'create',
        payload: {
          title: 'Follow-up task',
          description: 'Check mobile layout',
          priority: 'high',
          labels: [{ id: 'label_ui', name: 'ui', color: 'blue' }],
          acceptanceCriteria: [],
        },
      },
      {
        type: 'update',
        payload: {
          taskId: 'task_123',
          patch: { blockedReason: 'Needs credentials' },
        },
      },
    ])
  })

  it('leaves invalid JSON marker blocks in clean text', () => {
    const text = `Keep this output.

\`\`\`kanban:create
{"title":
\`\`\`

Done.`

    const result = parseKanbanMarkers(text)

    expect(result.markers).toEqual([])
    expect(result.cleanText).toContain('Keep this output.')
    expect(result.cleanText).toContain('```kanban:create')
    expect(result.cleanText).toContain('{"title":')
    expect(result.cleanText).toContain('Done.')
  })
})
