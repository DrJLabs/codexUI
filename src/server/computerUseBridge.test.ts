import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveComputerUseBinary } from './computerUseBridge'

describe('resolveComputerUseBinary', () => {
  it('uses CODEXUI_COMPUTER_USE_BINARY when provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codexui-cua-'))
    const binary = join(dir, 'codex-computer-use-linux')
    writeFileSync(binary, '#!/bin/sh\nexit 0\n')
    chmodSync(binary, 0o755)

    expect(resolveComputerUseBinary({ CODEXUI_COMPUTER_USE_BINARY: binary })).toMatchObject({
      path: binary,
      source: 'env',
      exists: true,
      executable: true,
      error: null,
    })
  })

  it('reports a forced missing binary without falling back to bundled paths', () => {
    const missing = join(tmpdir(), 'codexui-cua-missing')
    expect(resolveComputerUseBinary({ CODEXUI_COMPUTER_USE_BINARY: missing })).toMatchObject({
      path: missing,
      source: 'env',
      exists: false,
      executable: false,
    })
  })
})
