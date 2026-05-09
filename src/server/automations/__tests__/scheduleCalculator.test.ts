import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyRruleScheduleKind, evaluateRruleSchedule } from '../scheduleCalculator'

const originalTz = process.env.TZ

beforeEach(() => {
  process.env.TZ = 'UTC'
})

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ
  } else {
    process.env.TZ = originalTz
  }
})

describe('evaluateRruleSchedule', () => {
  it('classifies Desktop interval schedules separately from wall-clock schedules', () => {
    expect(classifyRruleScheduleKind('FREQ=MINUTELY;INTERVAL=15')).toEqual({
      scheduleKind: 'interval',
      intervalMs: 15 * 60_000,
    })
    expect(classifyRruleScheduleKind('FREQ=HOURLY;INTERVAL=6')).toEqual({
      scheduleKind: 'interval',
      intervalMs: 6 * 60 * 60_000,
    })
    expect(classifyRruleScheduleKind('RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA')).toEqual({
      scheduleKind: 'wall_clock',
      intervalMs: null,
    })
    expect(classifyRruleScheduleKind('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')).toEqual({
      scheduleKind: 'wall_clock',
      intervalMs: null,
    })
  })

  it('accepts Desktop-prefixed RRULE strings through scheduler normalization', () => {
    const decision = evaluateRruleSchedule({
      rrule: 'RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA',
      anchorIso: '2026-04-30T00:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-04-30T00:30:00.000Z',
    })

    expect(decision.nextDueAtIso).toBe('2026-04-30T01:00:00.000Z')
    expect(decision.unsupportedReason).toBeNull()
  })

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

  it('evaluates daily wall-clock schedules in the host local timezone', () => {
    process.env.TZ = 'America/New_York'

    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
      anchorIso: '2026-05-06T13:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-05-07T12:30:00.000Z',
    })

    expect(decision).toMatchObject({
      due: false,
      dueAtIso: null,
      nextDueAtIso: '2026-05-07T13:00:00.000Z',
      unsupportedReason: null,
    })
  })

  it('evaluates weekly BYDAY against the host local weekday', () => {
    process.env.TZ = 'America/New_York'

    const decision = evaluateRruleSchedule({
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      anchorIso: '2026-05-04T13:00:00.000Z',
      nextDueAtIso: null,
      nowIso: '2026-05-11T03:00:00.000Z',
    })

    expect(decision).toMatchObject({
      due: false,
      dueAtIso: null,
      nextDueAtIso: '2026-05-11T13:00:00.000Z',
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

  it('preserves invalid or scheduler-unsupported custom RRULEs as unsupported states', () => {
    for (const [rrule, reason] of [
      ['FREQ=DAILY;BYSECOND=30', 'BYSECOND'],
      ['FREQ=MINUTELY;INTERVAL=0', 'INTERVAL'],
      [`FREQ=MINUTELY;INTERVAL=${'9'.repeat(400)}`, 'INTERVAL'],
      ['FREQ=WEEKLY;BYDAY=__proto__', 'BYDAY'],
    ]) {
      expect(evaluateRruleSchedule({
        rrule,
        anchorIso: '2026-04-30T00:00:00.000Z',
        nextDueAtIso: null,
        nowIso: '2026-04-30T10:00:00.000Z',
      })).toEqual({
        due: false,
        dueAtIso: null,
        nextDueAtIso: null,
        missedRunPolicy: 'one_catch_up',
        unsupportedReason: expect.stringContaining(reason),
      })
    }
  })
})
