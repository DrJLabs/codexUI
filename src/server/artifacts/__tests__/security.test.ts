import { describe, expect, it } from 'vitest'
import type { WorkspaceArtifact } from '../../../types/workspaceArtifacts'
import { assertIndexedArtifactPath, isSensitiveArtifactPath } from '../security'

const artifact: WorkspaceArtifact = {
  id: 'kanban:evidence:run_1',
  kind: 'evidence',
  source: 'kanban',
  title: 'Run evidence',
  runId: 'run_1',
  logPath: '/tmp/codexui-safe.log',
}

describe('artifact security', () => {
  it('allows only paths indexed by the artifact descriptor', () => {
    expect(assertIndexedArtifactPath(artifact, '/tmp/codexui-safe.log')).toEqual({ allowed: true })
    expect(assertIndexedArtifactPath(artifact, '/tmp/other.log')).toMatchObject({
      allowed: false,
      reason: 'Artifact path is not indexed for this artifact',
    })
  })

  it('blocks sensitive filenames and secret directories', () => {
    expect(isSensitiveArtifactPath('/repo/.env')).toBe(true)
    expect(isSensitiveArtifactPath('/repo/.env.production')).toBe(true)
    expect(isSensitiveArtifactPath('/home/me/.ssh/id_ed25519')).toBe(true)
    expect(isSensitiveArtifactPath('/repo/cert.pem')).toBe(true)
    expect(assertIndexedArtifactPath({ ...artifact, logPath: '/repo/.env' }, '/repo/.env')).toMatchObject({
      allowed: false,
      reason: 'Artifact path is blocked by sensitive-file policy',
    })
  })
})
