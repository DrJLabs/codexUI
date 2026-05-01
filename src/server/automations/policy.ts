import type { AutomationDefinition } from '../../types/automations'
import type { CodexRunProfile } from '../../types/execution'
import type { KanbanExecutionPolicy } from '../../types/kanban'
import {
  BUILTIN_CODEX_RUN_PROFILES,
  DEFAULT_CODEX_RUN_PROFILE_ID,
} from '../execution/runProfiles'
import type { AutomationsRemoteAccess } from './remoteAccess'

export type AutomationRunProfileInput = {
  runProfiles?: CodexRunProfile[]
  runProfileId?: string | null
}

export function isAutomationExecutionPolicyEnabled(policy: KanbanExecutionPolicy): boolean {
  return policy.executionEnabled && policy.executionMode !== 'disabled'
}

export function assertAutomationExecutionPolicy(policy: KanbanExecutionPolicy): void {
  if (!isAutomationExecutionPolicyEnabled(policy)) {
    throw createAutomationPolicyError(403, 'Automation execution is disabled')
  }
}

export function assertAutomationExecutionAccess(access: AutomationsRemoteAccess, policy: KanbanExecutionPolicy): void {
  assertAutomationExecutionPolicy(policy)
  if (policy.requireLoopbackForExecution && !access.loopback) {
    throw createAutomationPolicyError(403, 'Automation execution requires loopback access')
  }
  if (policy.disableExecutionWhenRemote && !access.loopback) {
    throw createAutomationPolicyError(403, 'Automation execution is disabled for remote access')
  }
  if (policy.allowTailscaleAccess === false && access.tailscale) {
    throw createAutomationPolicyError(403, 'Automation execution does not allow Tailscale access')
  }
  if (policy.requireTrustedAccessForExecution !== false && !access.trusted) {
    throw createAutomationPolicyError(403, 'Automation execution requires trusted local or Tailscale access')
  }
  if (policy.executionMode === 'local_only' && !access.loopback) {
    throw createAutomationPolicyError(403, 'Automation execution mode allows local access only')
  }
  if (policy.executionMode === 'open_remote') {
    throw createAutomationPolicyError(403, 'Open remote automation execution requires authenticated remote access')
  }
}

export function resolveAutomationRunProfile(
  definition: AutomationDefinition,
  input: AutomationRunProfileInput,
): CodexRunProfile {
  const profiles = mergeRunProfiles(input.runProfiles)
  const requestedId = (input.runProfileId ?? definition.runProfileId ?? DEFAULT_CODEX_RUN_PROFILE_ID).trim()
  const profileId = profiles.some((profile) => profile.id === requestedId)
    ? requestedId
    : DEFAULT_CODEX_RUN_PROFILE_ID
  const baseProfile = profiles.find((profile) => profile.id === profileId)
    ?? profiles.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)
    ?? BUILTIN_CODEX_RUN_PROFILES.find((profile) => profile.id === DEFAULT_CODEX_RUN_PROFILE_ID)!
  return {
    ...baseProfile,
    model: definition.model?.trim() || baseProfile.model,
    reasoningEffort: normalizeReasoningEffort(definition.reasoningEffort) || baseProfile.reasoningEffort,
  }
}

export function assertAutomationRunProfileAllowed(profile: CodexRunProfile, policy: KanbanExecutionPolicy): void {
  if (profile.sandboxMode === 'danger-full-access' && !policy.allowDangerFullAccess) {
    throw createAutomationPolicyError(403, 'Automation run profile uses danger-full-access but policy does not allow it')
  }
  if (profile.approvalPolicy === 'never' && !policy.allowApprovalNever) {
    throw createAutomationPolicyError(403, 'Automation run profile uses approval policy never but policy does not allow it')
  }
  if (profile.networkAccess && !policy.networkAccess) {
    throw createAutomationPolicyError(403, 'Automation run profile enables network access but policy does not allow it')
  }
}

function mergeRunProfiles(extra: CodexRunProfile[] | undefined): CodexRunProfile[] {
  const merged = new Map<string, CodexRunProfile>()
  for (const profile of BUILTIN_CODEX_RUN_PROFILES) merged.set(profile.id, profile)
  for (const profile of extra ?? []) merged.set(profile.id, profile)
  return Array.from(merged.values())
}

function normalizeReasoningEffort(value: string | null): CodexRunProfile['reasoningEffort'] | '' {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ? value : ''
}

function createAutomationPolicyError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}
