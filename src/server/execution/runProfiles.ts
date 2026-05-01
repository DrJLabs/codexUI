import {
  FULL_ACCESS_CODEX_RUN_PROFILE_ID,
  type CodexRunProfile,
  type CodexRunProfileApprovalPolicy,
  type CodexRunProfileReasoningEffort,
  type CodexRunProfileSandboxMode,
  type CodexTurnStartRunSettings,
} from '../../types/execution'

export { FULL_ACCESS_CODEX_RUN_PROFILE_ID } from '../../types/execution'

export const DEFAULT_CODEX_RUN_PROFILE_ID = 'workspace-coding'

const BUILTIN_TIMESTAMP = '2026-04-29T00:00:00.000Z'

export const BUILTIN_CODEX_RUN_PROFILES: CodexRunProfile[] = [
  {
    id: 'read-only-planning',
    name: 'Read-only planning',
    description: 'Inspect and plan without workspace writes or network access.',
    model: '',
    reasoningEffort: 'medium',
    sandboxMode: 'read-only',
    approvalPolicy: 'on-request',
    networkAccess: false,
    writableRoots: [],
    createdAtIso: BUILTIN_TIMESTAMP,
    updatedAtIso: BUILTIN_TIMESTAMP,
  },
  {
    id: DEFAULT_CODEX_RUN_PROFILE_ID,
    name: 'Workspace coding',
    description: 'Default coding profile with workspace writes, approvals on request, and network disabled.',
    model: '',
    reasoningEffort: 'medium',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    networkAccess: false,
    writableRoots: [],
    createdAtIso: BUILTIN_TIMESTAMP,
    updatedAtIso: BUILTIN_TIMESTAMP,
  },
  {
    id: 'workspace-coding-network',
    name: 'Workspace coding + network',
    description: 'Workspace writes with network access enabled for dependency or documentation lookups.',
    model: '',
    reasoningEffort: 'medium',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    networkAccess: true,
    writableRoots: [],
    createdAtIso: BUILTIN_TIMESTAMP,
    updatedAtIso: BUILTIN_TIMESTAMP,
  },
  {
    id: FULL_ACCESS_CODEX_RUN_PROFILE_ID,
    name: 'Full-access operator',
    description: 'Danger full access with network enabled. Requires explicit operator selection.',
    model: '',
    reasoningEffort: 'medium',
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'on-request',
    networkAccess: true,
    writableRoots: [],
    createdAtIso: BUILTIN_TIMESTAMP,
    updatedAtIso: BUILTIN_TIMESTAMP,
  },
]

export type CodexRunProfileTaskOverrides = {
  runProfileId?: string | null
  model?: string | null
  thinking?: CodexRunProfileReasoningEffort | 'off' | null
}

export function normalizeCodexRunProfiles(value: unknown): CodexRunProfile[] {
  const customProfiles = Array.isArray(value)
    ? value.map(normalizeRunProfile).filter((profile): profile is CodexRunProfile => Boolean(profile))
    : []
  const merged = new Map<string, CodexRunProfile>()
  for (const profile of BUILTIN_CODEX_RUN_PROFILES) {
    merged.set(profile.id, profile)
  }
  for (const profile of customProfiles) {
    merged.set(profile.id, profile)
  }
  return Array.from(merged.values())
}

export function normalizeCodexRunProfileId(value: unknown, profiles: CodexRunProfile[]): string {
  const profileId = typeof value === 'string' ? value.trim() : ''
  if (profileId && profiles.some((profile) => profile.id === profileId)) return profileId
  return DEFAULT_CODEX_RUN_PROFILE_ID
}

export function assertKnownCodexRunProfile(profileId: string, profiles: CodexRunProfile[]): void {
  if (!profiles.some((profile) => profile.id === profileId)) {
    throw new Error(`Unknown Codex run profile: ${profileId}`)
  }
}

export function resolveEffectiveCodexRunProfile(input: {
  task: CodexRunProfileTaskOverrides
  profiles: CodexRunProfile[]
  defaultRunProfileId: string
}): CodexRunProfile {
  const profileId = input.task.runProfileId || input.defaultRunProfileId || DEFAULT_CODEX_RUN_PROFILE_ID
  const baseProfile = input.profiles.find((profile) => profile.id === profileId)
    ?? input.profiles.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)
    ?? BUILTIN_CODEX_RUN_PROFILES.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)!
  return {
    ...baseProfile,
    model: input.task.model?.trim() || baseProfile.model,
    reasoningEffort: input.task.thinking === 'off' ? '' : input.task.thinking || baseProfile.reasoningEffort,
  }
}

export function resolveCodexTurnStartRunSettings(profile: CodexRunProfile | null | undefined, worktreePath?: string): CodexTurnStartRunSettings {
  const effectiveProfile = profile
    ?? BUILTIN_CODEX_RUN_PROFILES.find((candidate) => candidate.id === DEFAULT_CODEX_RUN_PROFILE_ID)!
  const settings: CodexTurnStartRunSettings = {
    approvalPolicy: effectiveProfile.approvalPolicy,
    sandboxPolicy: toSandboxPolicy(effectiveProfile, worktreePath),
  }
  if (effectiveProfile.model.trim()) settings.model = effectiveProfile.model.trim()
  if (effectiveProfile.reasoningEffort) settings.effort = effectiveProfile.reasoningEffort
  return settings
}

function normalizeRunProfile(value: unknown): CodexRunProfile | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  if (!id) return null
  const sandboxMode = readSandboxMode(value.sandboxMode)
  const approvalPolicy = readApprovalPolicy(value.approvalPolicy)
  const reasoningEffort = readReasoningEffort(value.reasoningEffort)
  return {
    id,
    name: readString(value.name) || id,
    description: readString(value.description),
    model: readString(value.model),
    reasoningEffort,
    sandboxMode,
    approvalPolicy,
    networkAccess: value.networkAccess === true,
    writableRoots: Array.isArray(value.writableRoots)
      ? value.writableRoots.map(readString).filter(Boolean)
      : [],
    createdAtIso: readString(value.createdAtIso) || new Date().toISOString(),
    updatedAtIso: readString(value.updatedAtIso) || new Date().toISOString(),
  }
}

function toSandboxPolicy(profile: CodexRunProfile, worktreePath?: string): CodexTurnStartRunSettings['sandboxPolicy'] {
  if (profile.sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' }
  }
  if (profile.sandboxMode === 'read-only') {
    return {
      type: 'readOnly',
      access: { type: 'fullAccess' },
      networkAccess: profile.networkAccess,
    }
  }
  const writableRoots = Array.from(new Set([
    worktreePath?.trim() ?? '',
    ...profile.writableRoots.map((root) => root.trim()),
  ].filter(Boolean)))
  return {
    type: 'workspaceWrite',
    writableRoots,
    readOnlyAccess: { type: 'fullAccess' },
    networkAccess: profile.networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

function readSandboxMode(value: unknown): CodexRunProfileSandboxMode {
  return value === 'read-only' || value === 'danger-full-access' ? value : 'workspace-write'
}

function readApprovalPolicy(value: unknown): CodexRunProfileApprovalPolicy {
  return value === 'untrusted' || value === 'never' ? value : 'on-request'
}

function readReasoningEffort(value: unknown): CodexRunProfileReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : ''
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
