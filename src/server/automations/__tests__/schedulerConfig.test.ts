import { describe, expect, it } from 'vitest'
import { resolveAutomationSchedulerPreference } from '../schedulerConfig'

describe('resolveAutomationSchedulerPreference', () => {
  it('defaults to Desktop scheduler ownership when no env setting is provided', () => {
    const preference = resolveAutomationSchedulerPreference({}, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
  })

  it('supports explicit best-effort auto mode when no Codex desktop process is active', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'auto',
    }, () => false)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(true)
  })

  it('pauses scheduler ticks in explicit auto mode while Codex desktop is active', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'auto',
    }, () => true)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(false)
  })

  it('lets explicit enabled override desktop detection', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'enabled',
    }, () => true)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(true)
  })

  it('disables the scheduler when the env setting selects desktop ownership', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'desktop',
    }, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
  })

  it('disables the scheduler for unknown values instead of guessing ownership', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'maybe',
    }, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
  })
})
