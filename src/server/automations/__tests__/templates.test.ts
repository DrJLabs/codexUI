import { describe, expect, it } from 'vitest'
import { AUTOMATION_TEMPLATES } from '../templates'

describe('AUTOMATION_TEMPLATES', () => {
  it('includes the Desktop automation template groups', () => {
    expect(groupNames()).toEqual(expect.arrayContaining([
      'Status reports',
      'Release prep',
      'Incidents & triage',
      'Code quality',
      'Repo maintenance',
      'Growth & exploration',
    ]))
  })

  it('preserves Desktop template schedule defaults without RRULE prefixes', () => {
    expect(template('daily-standup').schedule.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0')
    expect(template('ci-monitor').schedule.rrule).toBe('FREQ=HOURLY;INTERVAL=2;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR')
    expect(template('dependency-sweep').schedule.rrule).toBe('FREQ=HOURLY;INTERVAL=720;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR,SA,SU')
    expect(template('weekly-release-notes').schedule.rrule).toBe('FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0')
    expect(AUTOMATION_TEMPLATES.every((candidate) => !candidate.schedule.rrule.startsWith('RRULE:'))).toBe(true)
  })

  it('keeps Desktop catalog entries canonical and worktree based', () => {
    const desktopTemplates = AUTOMATION_TEMPLATES.filter((candidate) => candidate.groupId !== 'codexui-template-aliases')
    expect(desktopTemplates).toHaveLength(17)
    expect(desktopTemplates.every((candidate) => candidate.kind === 'cron')).toBe(true)
    expect(desktopTemplates.every((candidate) => candidate.runMode === 'worktree')).toBe(true)
    expect(desktopTemplates.every((candidate) => candidate.prompt.trim().length > 0)).toBe(true)
  })

  it('keeps the simplified CodexUI choices as aliases', () => {
    expect(template('thread-heartbeat')).toMatchObject({
      kind: 'heartbeat',
      runMode: 'chat',
      groupName: 'Quick aliases',
    })
    expect(template('thread-heartbeat').schedule.rrule).toBe('FREQ=MINUTELY;INTERVAL=15')
    expect(template('project-cron')).toMatchObject({
      kind: 'cron',
      runMode: 'local',
      aliasFor: 'daily-bug-scan',
    })
    expect(template('worktree-check')).toMatchObject({
      kind: 'cron',
      runMode: 'worktree',
      aliasFor: 'performance-regression-watch',
    })
  })

  it('points every template alias at a real Desktop catalog entry', () => {
    const templateIds = new Set(AUTOMATION_TEMPLATES.map((candidate) => candidate.id))
    for (const candidate of AUTOMATION_TEMPLATES) {
      if (!candidate.aliasFor) continue
      expect(templateIds.has(candidate.aliasFor), `${candidate.id} alias target`).toBe(true)
      expect(template(candidate.aliasFor).groupId).not.toBe('codexui-template-aliases')
    }
  })
})

function template(id: string) {
  const candidate = AUTOMATION_TEMPLATES.find((item) => item.id === id)
  expect(candidate, `template ${id}`).toBeDefined()
  return candidate!
}

function groupNames(): string[] {
  return Array.from(new Set(AUTOMATION_TEMPLATES.map((candidate) => candidate.groupName)))
}
