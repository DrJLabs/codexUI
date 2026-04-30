import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CODEX_RUN_PROFILES,
  DEFAULT_CODEX_RUN_PROFILE_ID,
  FULL_ACCESS_CODEX_RUN_PROFILE_ID,
  assertKnownCodexRunProfile,
  normalizeCodexRunProfileId,
  normalizeCodexRunProfiles,
  resolveCodexTurnStartRunSettings,
  resolveEffectiveCodexRunProfile,
} from '../runProfiles'

describe('execution run profiles', () => {
  it('includes the existing workspace default and full-access built-in ids', () => {
    expect(BUILTIN_CODEX_RUN_PROFILES.map((profile) => profile.id)).toEqual([
      'read-only-planning',
      DEFAULT_CODEX_RUN_PROFILE_ID,
      'workspace-coding-network',
      FULL_ACCESS_CODEX_RUN_PROFILE_ID,
    ])
  })

  it('allows custom profiles to override built-ins by id', () => {
    const profiles = normalizeCodexRunProfiles([
      {
        id: DEFAULT_CODEX_RUN_PROFILE_ID,
        name: 'Custom workspace',
        description: 'Custom default.',
        model: 'gpt-custom',
        reasoningEffort: 'high',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        networkAccess: true,
        writableRoots: ['/custom'],
        createdAtIso: '2026-04-30T00:00:00.000Z',
        updatedAtIso: '2026-04-30T00:00:00.000Z',
      },
    ])

    expect(profiles).toHaveLength(BUILTIN_CODEX_RUN_PROFILES.length)
    expect(profiles.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)).toMatchObject({
      name: 'Custom workspace',
      model: 'gpt-custom',
      approvalPolicy: 'never',
      networkAccess: true,
      writableRoots: ['/custom'],
    })
  })

  it('ignores invalid profile input and falls back to the default id', () => {
    const profiles = normalizeCodexRunProfiles([
      null,
      {},
      { id: '  ' },
      { id: 'custom', sandboxMode: 'invalid', approvalPolicy: 'invalid', reasoningEffort: 'invalid' },
    ])

    expect(profiles.map((profile) => profile.id)).toEqual([
      'read-only-planning',
      DEFAULT_CODEX_RUN_PROFILE_ID,
      'workspace-coding-network',
      FULL_ACCESS_CODEX_RUN_PROFILE_ID,
      'custom',
    ])
    expect(profiles.find((profile) => profile.id === 'custom')).toMatchObject({
      name: 'custom',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      reasoningEffort: '',
    })
    expect(normalizeCodexRunProfileId('missing', profiles)).toBe(DEFAULT_CODEX_RUN_PROFILE_ID)
    expect(() => assertKnownCodexRunProfile('missing', profiles)).toThrow('Unknown Codex run profile: missing')
  })

  it('maps workspace-write settings with worktree path and custom writable roots', () => {
    const settings = resolveCodexTurnStartRunSettings({
      ...BUILTIN_CODEX_RUN_PROFILES.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)!,
      networkAccess: true,
      writableRoots: ['/repo', ' /tmp/cache ', '/repo'],
    }, ' /repo/worktree ')

    expect(settings).toEqual({
      approvalPolicy: 'on-request',
      effort: 'medium',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: ['/repo/worktree', '/repo', '/tmp/cache'],
        readOnlyAccess: { type: 'fullAccess' },
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    })
  })

  it('resolves effective profiles from neutral task override fields', () => {
    const profiles = normalizeCodexRunProfiles(undefined)

    const profile = resolveEffectiveCodexRunProfile({
      task: {
        runProfileId: FULL_ACCESS_CODEX_RUN_PROFILE_ID,
        model: ' gpt-5.4 ',
        thinking: 'off',
      },
      profiles,
      defaultRunProfileId: DEFAULT_CODEX_RUN_PROFILE_ID,
    })

    expect(profile).toMatchObject({
      id: FULL_ACCESS_CODEX_RUN_PROFILE_ID,
      model: 'gpt-5.4',
      reasoningEffort: '',
    })
  })
})
