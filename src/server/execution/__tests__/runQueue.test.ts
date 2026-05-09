import { describe, expect, it } from 'vitest'
import {
  ExecutionRunQueue,
  ExecutionRunQueueDuplicateOwnerError,
  ExecutionRunQueueDuplicateRunError,
} from '../runQueue'

describe('ExecutionRunQueue', () => {
  it('keeps one global active run and promotes the next eligible item on completion', () => {
    const queue = new ExecutionRunQueue()

    const first = queue.enqueue({ runId: 'run_1', ownerKey: 'owner:1', repoRoot: '/repo/a' })
    const second = queue.enqueue({ runId: 'run_2', ownerKey: 'owner:2', repoRoot: '/repo/b' })
    const promoted = queue.complete('run_1')

    expect(first.state).toBe('active')
    expect(second).toMatchObject({ state: 'queued', reason: 'global_limit' })
    expect(promoted).toEqual([{ runId: 'run_2', ownerKey: 'owner:2', repoRoot: '/repo/b' }])
    expect(queue.getActiveRunIds()).toEqual(['run_2'])
  })

  it('enforces repo and owner concurrency limits independently', () => {
    const repoQueue = new ExecutionRunQueue({
      maxGlobalActiveRuns: 2,
      maxActiveRunsPerRepo: 1,
      maxActiveRunsPerOwner: 1,
    })
    const ownerQueue = new ExecutionRunQueue({
      maxGlobalActiveRuns: 2,
      maxActiveRunsPerRepo: 2,
      maxActiveRunsPerOwner: 1,
    })

    expect(repoQueue.enqueue({ runId: 'run_1', ownerKey: 'owner:1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(repoQueue.enqueue({ runId: 'run_2', ownerKey: 'owner:2', repoRoot: '/repo/a' })).toMatchObject({
      state: 'queued',
      reason: 'repo_limit',
    })
    expect(ownerQueue.enqueue({ runId: 'run_1', ownerKey: 'owner:1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(ownerQueue.enqueue({ runId: 'run_2', ownerKey: 'owner:1', repoRoot: '/repo/b' })).toMatchObject({
      state: 'queued',
      reason: 'owner_limit',
    })
  })

  it('rejects duplicate run ids across active and queued runs', () => {
    const queue = new ExecutionRunQueue({ maxGlobalActiveRuns: 1 })

    expect(queue.enqueue({ runId: 'run_1', ownerKey: 'owner:1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(queue.enqueue({ runId: 'run_2', ownerKey: 'owner:2', repoRoot: '/repo/b' }).state).toBe('queued')

    expect(() => queue.enqueue({ runId: 'run_1', ownerKey: 'owner:3', repoRoot: '/repo/c' }))
      .toThrow('Execution run run_1 is already queued')
    expect(() => queue.enqueue({ runId: 'run_1', ownerKey: 'owner:3', repoRoot: '/repo/c' }))
      .toThrow(ExecutionRunQueueDuplicateRunError)
    expect(() => queue.enqueue({ runId: 'run_2', ownerKey: 'owner:3', repoRoot: '/repo/c' }))
      .toThrow('Execution run run_2 is already queued')
    expect(() => queue.enqueue({ runId: 'run_2', ownerKey: 'owner:3', repoRoot: '/repo/c' }))
      .toThrow(ExecutionRunQueueDuplicateRunError)
  })

  it('rejects duplicate queued owners', () => {
    const queue = new ExecutionRunQueue({ maxGlobalActiveRuns: 1 })

    expect(queue.enqueue({ runId: 'run_1', ownerKey: 'owner:1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(queue.enqueue({ runId: 'run_2', ownerKey: 'owner:2', repoRoot: '/repo/b' })).toMatchObject({
      state: 'queued',
      reason: 'global_limit',
    })

    expect(() => queue.enqueue({ runId: 'run_3', ownerKey: 'owner:2', repoRoot: '/repo/c' }))
      .toThrow('Execution owner owner:2 already has a queued run')
    expect(() => queue.enqueue({ runId: 'run_3', ownerKey: 'owner:2', repoRoot: '/repo/c' }))
      .toThrow(ExecutionRunQueueDuplicateOwnerError)
    expect(queue.getQueuedRunIds()).toEqual(['run_2'])
  })

  it('promotes all eligible queued items after active runs complete or cancel', () => {
    const queue = new ExecutionRunQueue({
      maxGlobalActiveRuns: 3,
      maxActiveRunsPerRepo: 1,
      maxActiveRunsPerOwner: 1,
    })

    expect(queue.enqueue({ runId: 'run_1', ownerKey: 'owner:1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(queue.enqueue({ runId: 'run_2', ownerKey: 'owner:2', repoRoot: '/repo/b' }).state).toBe('active')
    expect(queue.enqueue({ runId: 'run_3', ownerKey: 'owner:3', repoRoot: '/repo/a' })).toMatchObject({
      state: 'queued',
      reason: 'repo_limit',
    })
    expect(queue.enqueue({ runId: 'run_4', ownerKey: 'owner:2', repoRoot: '/repo/c' })).toMatchObject({
      state: 'queued',
      reason: 'owner_limit',
    })

    expect(queue.complete('run_1')).toEqual([{ runId: 'run_3', ownerKey: 'owner:3', repoRoot: '/repo/a' }])
    expect(queue.cancel('run_2')).toEqual([{ runId: 'run_4', ownerKey: 'owner:2', repoRoot: '/repo/c' }])
    expect(queue.getActiveRunIds()).toEqual(['run_3', 'run_4'])
  })

  it('rejects invalid concurrency limits at construction time', () => {
    expect(() => new ExecutionRunQueue({ maxGlobalActiveRuns: 0 }))
      .toThrow('maxGlobalActiveRuns must be an integer >= 1')
    expect(() => new ExecutionRunQueue({ maxActiveRunsPerRepo: -1 }))
      .toThrow('maxActiveRunsPerRepo must be an integer >= 1')
    expect(() => new ExecutionRunQueue({ maxActiveRunsPerOwner: 1.5 }))
      .toThrow('maxActiveRunsPerOwner must be an integer >= 1')
  })
})
