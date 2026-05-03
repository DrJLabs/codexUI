import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canRunComputerUseAction,
  isLoopbackHost,
  mapDragPayload,
  mapTargetPayload,
  parseComputerUseToolResult,
  resolveComputerUseBinary,
} from './computerUseBridge'

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

describe('parseComputerUseToolResult', () => {
  it('parses JSON from MCP text content and preserves raw content', () => {
    const result = parseComputerUseToolResult('doctor', {
      content: [{ type: 'text', text: '{"ok":true,"checks":[{"name":"ydotool","ok":true}]}' }],
    })
    expect(result.ok).toBe(true)
    expect(result.result).toEqual({ ok: true, checks: [{ name: 'ydotool', ok: true }] })
    expect(result.rawContent).toHaveLength(1)
  })
})

describe('Computer Use action safety and payload mapping', () => {
  it('allows loopback hosts for action routes', () => {
    expect(isLoopbackHost('127.0.0.1:5173')).toBe(true)
    expect(isLoopbackHost('localhost:5173')).toBe(true)
    expect(isLoopbackHost('[::1]:5173')).toBe(true)
    expect(isLoopbackHost('100.127.77.25:5173')).toBe(false)
  })

  it('allows remote actions only with explicit env flag', () => {
    const req = { headers: { host: '100.127.77.25:5173' } } as never
    expect(canRunComputerUseAction(req, {})).toBe(false)
    expect(canRunComputerUseAction(req, { CODEXUI_COMPUTER_USE_ALLOW_REMOTE: '1' })).toBe(true)
  })

  it('maps drag and target payloads to backend field names', () => {
    expect(mapDragPayload({ startX: 1, startY: 2, endX: 3, endY: 4 })).toEqual({
      start_x: 1,
      start_y: 2,
      end_x: 3,
      end_y: 4,
    })
    expect(mapTargetPayload({
      windowId: '42',
      wmClass: 'Code',
      terminalCwd: '/tmp',
      terminalCommand: 'vim',
    })).toMatchObject({
      window_id: 42,
      wm_class: 'Code',
      terminal_cwd: '/tmp',
      terminal_command: 'vim',
    })
  })
})
