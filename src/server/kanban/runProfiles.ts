import type { CodexRunProfile, KanbanTask } from '../../types/kanban'
import {
  BUILTIN_CODEX_RUN_PROFILES,
  DEFAULT_CODEX_RUN_PROFILE_ID,
  FULL_ACCESS_CODEX_RUN_PROFILE_ID,
  normalizeCodexRunProfileId,
  normalizeCodexRunProfiles,
  resolveCodexTurnStartRunSettings,
  resolveEffectiveCodexRunProfile,
} from '../execution/runProfiles'

export {
  resolveCodexTurnStartRunSettings,
}

export const DEFAULT_KANBAN_RUN_PROFILE_ID = DEFAULT_CODEX_RUN_PROFILE_ID

export const FULL_ACCESS_KANBAN_RUN_PROFILE_ID = FULL_ACCESS_CODEX_RUN_PROFILE_ID

export const BUILTIN_KANBAN_RUN_PROFILES = BUILTIN_CODEX_RUN_PROFILES

export function normalizeKanbanRunProfiles(value: unknown): CodexRunProfile[] {
  return normalizeCodexRunProfiles(value)
}

export function normalizeKanbanRunProfileId(value: unknown, profiles: CodexRunProfile[]): string {
  return normalizeCodexRunProfileId(value, profiles)
}

export function assertKnownKanbanRunProfile(profileId: string, profiles: CodexRunProfile[]): void {
  if (!profiles.some((profile) => profile.id === profileId)) {
    throw new Error(`Unknown Kanban run profile: ${profileId}`)
  }
}

export function resolveEffectiveKanbanRunProfile(input: {
  task: KanbanTask
  profiles: CodexRunProfile[]
  defaultRunProfileId: string
}): CodexRunProfile {
  return resolveEffectiveCodexRunProfile(input)
}
