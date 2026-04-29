import { basename, extname, resolve } from 'node:path'
import type { WorkspaceArtifact } from '../../types/workspaceArtifacts'

const BLOCKED_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
])

const BLOCKED_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
])

export const ARTIFACT_PREVIEW_MAX_BYTES = 512 * 1024
export const ARTIFACT_RAW_MAX_BYTES = 10 * 1024 * 1024

export type ArtifactAccessCheck = {
  allowed: boolean
  reason?: string
}

export function assertIndexedArtifactPath(artifact: WorkspaceArtifact, filePath: string): ArtifactAccessCheck {
  const normalizedPath = resolve(filePath)
  if (!normalizedPath) return { allowed: false, reason: 'Artifact path is empty' }
  if (isSensitiveArtifactPath(normalizedPath)) {
    return { allowed: false, reason: 'Artifact path is blocked by sensitive-file policy' }
  }
  if (artifact.kind === 'evidence') {
    const indexedPaths = [artifact.logPath, artifact.eventsPath]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => resolve(value))
    if (indexedPaths.includes(normalizedPath)) return { allowed: true }
  }
  return { allowed: false, reason: 'Artifact path is not indexed for this artifact' }
}

export function isSensitiveArtifactPath(filePath: string): boolean {
  const name = basename(filePath)
  if (BLOCKED_BASENAMES.has(name)) return true
  if (/^\.env[.-]/u.test(name)) return true
  if (BLOCKED_EXTENSIONS.has(extname(name).toLowerCase())) return true
  return /(^|[/\\])\.ssh([/\\]|$)/u.test(filePath)
    || /(^|[/\\])\.gnupg([/\\]|$)/u.test(filePath)
}
