import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../../types/codex'
import {
  buildPlanCopyText,
  parsePlanFromMessageText,
  selectActivePlanMessage,
  showImplementPlanButton,
} from './planUtils'

function message(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: overrides.id ?? 'message-1',
    role: overrides.role ?? 'assistant',
    text: overrides.text ?? '',
    ...overrides,
  }
}

describe('planUtils', () => {
  it('parses explanation and completed, in-progress, and pending steps from checkbox text', () => {
    const planData = parsePlanFromMessageText(`
      Ship this in order.

      - [x] Read existing plan rendering
      - [~] Extract shared utility
      - [ ] Wire floating dock
    `)

    expect(planData).toEqual({
      explanation: 'Ship this in order.',
      steps: [
        { step: 'Read existing plan rendering', status: 'completed' },
        { step: 'Extract shared utility', status: 'inProgress' },
        { step: 'Wire floating dock', status: 'pending' },
      ],
    })
  })

  it('prefers a live plan over a newer completed plan', () => {
    const livePlan = message({
      id: 'live-plan',
      messageType: 'plan.live',
      plan: { steps: [{ step: 'Streaming step', status: 'inProgress' }], isStreaming: true },
    })
    const newerCompletedPlan = message({
      id: 'completed-plan',
      messageType: 'plan',
      plan: { steps: [{ step: 'Completed step', status: 'completed' }] },
    })

    expect(selectActivePlanMessage([livePlan, newerCompletedPlan])).toBe(livePlan)
  })

  it('picks the latest completed assistant plan when no live plan exists', () => {
    const oldAssistantPlan = message({ id: 'old-plan', messageType: 'plan' })
    const userPlan = message({ id: 'user-plan', role: 'user', messageType: 'plan' })
    const latestAssistantPlan = message({ id: 'latest-plan', messageType: 'plan' })

    expect(selectActivePlanMessage([oldAssistantPlan, userPlan, latestAssistantPlan])).toBe(latestAssistantPlan)
  })

  it('shows Implement Plan only for completed assistant plans with a turnId', () => {
    expect(showImplementPlanButton(message({ messageType: 'plan.live', turnId: 'turn-1' }))).toBe(false)
    expect(showImplementPlanButton(message({ messageType: 'plan', turnId: 'turn-1' }))).toBe(true)
  })

  it('builds copy text from structured plan data', () => {
    const planMessage = message({
      messageType: 'plan',
      text: '- [ ] fallback text',
      plan: {
        explanation: '  Structured plan  ',
        steps: [
          { step: 'Finish first', status: 'completed' },
          { step: 'Keep moving', status: 'inProgress' },
          { step: 'Wrap up', status: 'pending' },
        ],
      },
    })

    expect(buildPlanCopyText(planMessage)).toBe([
      'Structured plan',
      '- [x] Finish first\n- [~] Keep moving\n- [ ] Wrap up',
    ].join('\n\n'))
  })
})
