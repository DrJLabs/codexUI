import { describe, expect, it } from 'vitest'
import { evaluateRruleSchedule } from '../scheduleCalculator'

describe('evaluateRruleSchedule', () => {
  it('computes minutely interval schedules from the anchor minute', () => {
    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=MINUTELY;INTERVAL=15',
      anchorIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-30T09:16:00.000Z',
    })

    expect(decision).toMatchObject({
      due: true,
      dueAtIso: '2026-04-30T09:15:00.000Z',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      unsupportedReason: null,
    })
  })

  it('reports one due daily occurrence and advances the next due after now', () => {
    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=30',
      anchorIso: '2026-04-29T09:30:00.000Z',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      nowIso: '2026-04-30T10:00:00.000Z',
    })

    expect(decision).toEqual({
      due: true,
      dueAtIso: '2026-04-30T09:30:00.000Z',
      nextDueAtIso: '2026-05-01T09:30:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
    })
  })

  it('catches up only the persisted due and skips missed intervals when advancing', () => {
    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=HOURLY;INTERVAL=2;BYMINUTE=0',
      anchorIso: '2026-04-30T00:00:00.000Z',
      nextDueAtIso: '2026-04-29T22:00:00.000Z',
      nowIso: '2026-04-30T10:15:00.000Z',
    })

    expect(decision.due).toBe(true)
    expect(decision.dueAtIso).toBe('2026-04-29T22:00:00.000Z')
    expect(decision.nextDueAtIso).toBe('2026-04-30T12:00:00.000Z')
  })

  it('honors weekly BYDAY when computing the next future due', () => {
    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=8;BYMINUTE=0',
      anchorIso: '2026-04-27T08:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-28T12:00:00.000Z',
    })

    expect(decision).toMatchObject({
      due: false,
      dueAtIso: null,
      nextDueAtIso: '2026-04-29T08:00:00.000Z',
      unsupportedReason: null,
    })
  })

  it('uses the anchor weekday for weekly schedules without BYDAY', () => {
    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=WEEKLY;INTERVAL=1',
      anchorIso: '2026-04-27T08:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-28T12:00:00.000Z',
    })

    expect(decision).toMatchObject({
      due: false,
      dueAtIso: null,
      nextDueAtIso: '2026-05-04T08:00:00.000Z',
      unsupportedReason: null,
    })
  })

  it('returns an unsupported result for monthly and yearly schedules', () => {
    for (const rrule of ['FREQ=MONTHLY;BYHOUR=9', 'FREQ=YEARLY;BYHOUR=9']) {
      expect(evaluateRruleSchedule({
        rrule,
        anchorIso: '2026-04-30T00:00:00.000Z',
        nextDueAtIso: '2026-04-30T09:00:00.000Z',
        nowIso: '2026-04-30T10:00:00.000Z',
      })).toEqual({
        due: false,
        dueAtIso: null,
        nextDueAtIso: null,
        missedRunPolicy: 'one_catch_up',
        unsupportedReason: expect.stringContaining('not implemented'),
      })
    }
  })

  it('throws scheduler-specific errors for invalid direct RRULE fields', () => {
    expect(() => evaluateRruleSchedule({
      rrule: 'FREQ=DAILY;BYSECOND=30',
      anchorIso: '2026-04-30T00:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-30T10:00:00.000Z',
    })).toThrow(/Unsupported automation RRULE for scheduler: .*BYSECOND/)

    expect(() => evaluateRruleSchedule({
      rrule: 'FREQ=MINUTELY;INTERVAL=0',
      anchorIso: '2026-04-30T00:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-30T10:00:00.000Z',
    })).toThrow(/Unsupported automation RRULE for scheduler: .*INTERVAL/)

    expect(() => evaluateRruleSchedule({
      rrule: `FREQ=MINUTELY;INTERVAL=${'9'.repeat(400)}`,
      anchorIso: '2026-04-30T00:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-30T10:00:00.000Z',
    })).toThrow(/Unsupported automation RRULE for scheduler: .*INTERVAL/)

    expect(() => evaluateRruleSchedule({
      rrule: 'FREQ=WEEKLY;BYDAY=__proto__',
      anchorIso: '2026-04-30T00:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-30T10:00:00.000Z',
    })).toThrow(/Unsupported automation RRULE for scheduler: .*BYDAY/)
  })
})
