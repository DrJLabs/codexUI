import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CODEX_RUN_PROFILES,
  DEFAULT_CODEX_RUN_PROFILE_ID,
  FULL_ACCESS_CODEX_RUN_PROFILE_ID,
  assertKnownCodexRunProfile,
  mergeCodexRunProfiles,
  normalizeCodexConfigProfiles,
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
    expect(BUILTIN_CODEX_RUN_PROFILES.every((profile) => profile.source === 'builtin')).toBe(true)
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

  it('normalizes Codex config.toml profiles for UI selection', () => {
    const profiles = normalizeCodexConfigProfiles({
      planning_fast: {
        model: 'gpt-5.4-mini',
        model_reasoning_effort: 'low',
        sandbox_mode: 'read-only',
        approval_policy: 'on-request',
      },
      'network-coding': {
        model: 'gpt-5.5',
        modelReasoningEffort: 'high',
        sandboxMode: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: true },
      },
      top_network: {
        approvalPolicy: 'never',
        network_access: true,
      },
    })

    expect(profiles).toMatchObject([
      {
        id: 'planning_fast',
        name: 'Planning Fast',
        source: 'config',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'low',
        sandboxMode: 'read-only',
        approvalPolicy: 'on-request',
        networkAccess: false,
        writableRoots: [],
      },
      {
        id: 'network-coding',
        name: 'Network Coding',
        source: 'config',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        networkAccess: true,
        writableRoots: [],
      },
      {
        id: 'top_network',
        name: 'Top Network',
        source: 'config',
        model: '',
        reasoningEffort: 'medium',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        networkAccess: true,
        writableRoots: [],
      },
    ])
    expect(profiles.every((profile) => !Number.isNaN(Date.parse(profile.createdAtIso)))).toBe(true)
    expect(profiles.every((profile) => !Number.isNaN(Date.parse(profile.updatedAtIso)))).toBe(true)
    expect(profiles[0]?.description).toContain('config.toml profile')
  })

  it('lets config.toml profiles override built-in profile ids', () => {
    const profiles = mergeCodexRunProfiles(normalizeCodexConfigProfiles({
      'workspace-coding': {
        model: 'gpt-5.5',
        model_reasoning_effort: 'xhigh',
        sandbox_mode: 'workspace-write',
      },
    }))

    expect(profiles).toHaveLength(BUILTIN_CODEX_RUN_PROFILES.length)
    expect(profiles.find((profile) => profile.id === 'workspace-coding')).toMatchObject({
      source: 'config',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    })
  })

  it('preserves supported Codex config enum values', () => {
    const profiles = normalizeCodexConfigProfiles({
      minimal_profile: {
        model_reasoning_effort: 'minimal',
        approval_policy: 'on-failure',
      },
      no_reasoning: {
        model_reasoning_effort: 'none',
      },
    })

    expect(profiles.find((profile) => profile.id === 'minimal_profile')).toMatchObject({
      reasoningEffort: 'minimal',
      approvalPolicy: 'on-failure',
    })
    expect(profiles.find((profile) => profile.id === 'no_reasoning')).toMatchObject({
      reasoningEffort: 'none',
    })
  })

  it('normalizes partial config.toml profiles against top-level config values', () => {
    const profiles = normalizeCodexConfigProfiles({
      model_only: {
        model: 'gpt-5.5',
      },
    }, {
      model: 'gpt-5.4',
      reasoningEffort: 'minimal',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-failure',
      networkAccess: true,
    })

    expect(profiles).toMatchObject([
      {
        id: 'model_only',
        model: 'gpt-5.5',
        reasoningEffort: 'minimal',
        sandboxMode: 'read-only',
        approvalPolicy: 'on-failure',
        networkAccess: true,
      },
    ])
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
