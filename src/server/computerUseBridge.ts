import { accessSync, constants } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { createInterface, type Interface } from 'node:readline'

export type ComputerUseBinaryResolution = {
  path: string
  source: 'env' | 'desktop-opt' | 'desktop-lab' | 'desktop-app' | 'cargo-release' | 'missing'
  exists: boolean
  executable: boolean
  error: string | null
}

export type ComputerUseRouteContext = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
}

type McpJsonRpcResponse = {
  jsonrpc?: '2.0'
  id?: number
  result?: unknown
  error?: { code: number, message: string }
}

type McpTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

export type ComputerUseToolResult = {
  ok: boolean
  tool: string
  result: unknown
  rawContent: unknown[]
  error?: string
}

const CANDIDATE_BINARIES: Array<{ source: ComputerUseBinaryResolution['source'], path: string }> = [
  {
    source: 'desktop-opt',
    path: '/opt/codex-desktop/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux',
  },
  {
    source: 'desktop-lab',
    path: '/home/drj/tools/codex-desktop-linux/codex-cua-lab-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux',
  },
  {
    source: 'desktop-app',
    path: '/home/drj/tools/codex-desktop-linux/codex-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux',
  },
  {
    source: 'cargo-release',
    path: '/home/drj/tools/codex-desktop-linux/target/release/codex-computer-use-linux',
  },
]

function inspectBinary(path: string, source: ComputerUseBinaryResolution['source']): ComputerUseBinaryResolution {
  try {
    accessSync(path, constants.F_OK)
  } catch (error) {
    return {
      path,
      source,
      exists: false,
      executable: false,
      error: error instanceof Error ? error.message : 'Binary does not exist',
    }
  }

  try {
    accessSync(path, constants.X_OK)
    return {
      path,
      source,
      exists: true,
      executable: true,
      error: null,
    }
  } catch (error) {
    return {
      path,
      source,
      exists: true,
      executable: false,
      error: error instanceof Error ? error.message : 'Binary is not executable',
    }
  }
}

export function resolveComputerUseBinary(env: NodeJS.ProcessEnv = process.env): ComputerUseBinaryResolution {
  const forcedPath = env.CODEXUI_COMPUTER_USE_BINARY?.trim()
  if (forcedPath) return inspectBinary(forcedPath, 'env')

  for (const candidate of CANDIDATE_BINARIES) {
    const inspected = inspectBinary(candidate.path, candidate.source)
    if (inspected.executable) return inspected
  }

  const fallback = CANDIDATE_BINARIES[0]
  return {
    path: fallback.path,
    source: 'missing',
    exists: false,
    executable: false,
    error: 'No executable Computer Use binary found',
  }
}

export function parseComputerUseToolResult(tool: string, payload: unknown): ComputerUseToolResult {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const rawContent = Array.isArray(record.content) ? record.content : []
  const firstTextItem = rawContent
    .map((item) => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .find((item) => item?.type === 'text' && typeof item.text === 'string')
  const firstText = typeof firstTextItem?.text === 'string' ? firstTextItem.text : null
  if (!firstText) {
    return {
      ok: false,
      tool,
      result: null,
      rawContent,
      error: 'MCP tool returned no text content',
    }
  }

  try {
    return {
      ok: true,
      tool,
      result: JSON.parse(firstText) as unknown,
      rawContent,
    }
  } catch {
    return {
      ok: true,
      tool,
      result: firstText,
      rawContent,
    }
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isMcpTool(value: unknown): value is McpTool {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  return typeof record?.name === 'string'
}

export class ComputerUseMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private lineReader: Interface | null = null
  private nextRequestId = 1
  private pendingResponses = new Map<number, {
    resolve: (value: McpJsonRpcResponse) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private startPromise: Promise<void> | null = null
  private callQueue: Promise<unknown> = Promise.resolve()
  private initialized = false
  private tools: McpTool[] = []
  private lastError: string | null = null
  private startedAtIso: string | null = null

  async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed && this.initialized) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.start()
      .finally(() => {
        this.startPromise = null
      })
    return this.startPromise
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureStarted()
    return this.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ComputerUseToolResult> {
    const task = async () => {
      await this.ensureStarted()
      const response = await this.sendRequest('tools/call', {
        name,
        arguments: args,
      })
      return parseComputerUseToolResult(name, response.result)
    }
    const queued = this.callQueue.then(task, task)
    this.callQueue = queued.catch(() => {})
    return queued
  }

  getStatus(): {
    running: boolean
    pid: number | null
    initialized: boolean
    toolCount: number
    lastError: string | null
    startedAtIso: string | null
  } {
    return {
      running: Boolean(this.child && !this.child.killed),
      pid: this.child?.pid ?? null,
      initialized: this.initialized,
      toolCount: this.tools.length,
      lastError: this.lastError,
      startedAtIso: this.startedAtIso,
    }
  }

  dispose(): void {
    const child = this.child
    this.child = null
    this.initialized = false
    this.tools = []
    this.lineReader?.close()
    this.lineReader = null
    this.rejectPending(new Error('Computer Use MCP client disposed'))
    if (child && !child.killed) {
      child.kill()
    }
  }

  private async start(): Promise<void> {
    this.dispose()
    const binary = resolveComputerUseBinary()
    if (!binary.executable) {
      this.lastError = binary.error ?? 'Computer Use binary is not executable'
      throw new Error(this.lastError)
    }

    const child = spawn(binary.path, ['mcp'], {
      cwd: dirname(binary.path),
      env: {
        ...process.env,
      },
    })
    this.child = child
    this.startedAtIso = new Date().toISOString()
    this.lastError = null

    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) this.lastError = message
    })
    child.on('error', (error) => {
      this.lastError = error.message
      this.rejectPending(error)
      this.resetProcess(child)
    })
    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      if (code !== 0 && code !== null) {
        this.lastError = `Computer Use MCP exited with code ${code}`
      } else if (signal) {
        this.lastError = `Computer Use MCP exited from signal ${signal}`
      }
      this.rejectPending(new Error(this.lastError ?? 'Computer Use MCP exited'))
      this.resetProcess(child)
    })

    this.lineReader = createInterface({ input: child.stdout })
    this.lineReader.on('line', (line) => this.handleLine(line))

    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'codexui',
        version: '0.0.0',
      },
    })
    this.sendNotification('notifications/initialized', {})
    const toolsResponse = await this.sendRequest('tools/list', {})
    const toolsRecord = asRecord(toolsResponse.result)
    this.tools = Array.isArray(toolsRecord.tools) ? toolsRecord.tools.filter(isMcpTool) : []
    this.initialized = true
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const child = this.child
    if (!child || child.killed || !child.stdin.writable) return
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    })}\n`)
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<McpJsonRpcResponse> {
    const child = this.child
    if (!child || child.killed || !child.stdin.writable) {
      return Promise.reject(new Error('Computer Use MCP process is not running'))
    }

    const id = this.nextRequestId++
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(id)
        reject(new Error(`Computer Use MCP request timed out: ${method}`))
      }, 30_000)

      this.pendingResponses.set(id, { resolve, reject, timeout })
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return
        clearTimeout(timeout)
        this.pendingResponses.delete(id)
        reject(error)
      })
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let response: McpJsonRpcResponse
    try {
      response = JSON.parse(trimmed) as McpJsonRpcResponse
    } catch {
      this.lastError = `Invalid Computer Use MCP JSON: ${trimmed.slice(0, 160)}`
      return
    }

    if (typeof response.id !== 'number') return
    const pending = this.pendingResponses.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingResponses.delete(response.id)
    if (response.error) {
      pending.reject(new Error(response.error.message))
      return
    }
    pending.resolve(response)
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pendingResponses) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pendingResponses.delete(id)
    }
  }

  private resetProcess(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = null
    this.initialized = false
    this.tools = []
    this.lineReader?.close()
    this.lineReader = null
  }
}

const sharedComputerUseClient = new ComputerUseMcpClient()

export function disposeComputerUseBridge(): void {
  sharedComputerUseClient.dispose()
}

const readOnlyToolByPath: Record<string, string> = {
  '/codex-api/computer-use/apps': 'list_apps',
  '/codex-api/computer-use/windows': 'list_windows',
  '/codex-api/computer-use/state': 'get_app_state',
  '/codex-api/computer-use/setup-accessibility': 'setup_accessibility',
  '/codex-api/computer-use/setup-window-targeting': 'setup_window_targeting',
}

export async function handleComputerUseRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: ComputerUseRouteContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/codex-api/computer-use')) return false

  const disabled = process.env.CODEXUI_COMPUTER_USE_DISABLED === '1'

  if (req.method === 'GET' && url.pathname === '/codex-api/computer-use/status') {
    if (disabled) {
      setJson(res, 200, {
        disabled,
        binary: resolveComputerUseBinary(),
        mcp: sharedComputerUseClient.getStatus(),
        doctor: null,
        error: 'Computer Use bridge is disabled',
      })
      return true
    }

    try {
      const doctor = await sharedComputerUseClient.callTool('doctor', {})
      setJson(res, 200, {
        disabled,
        binary: resolveComputerUseBinary(),
        mcp: sharedComputerUseClient.getStatus(),
        doctor,
      })
    } catch (error) {
      setJson(res, 503, {
        disabled,
        binary: resolveComputerUseBinary(),
        mcp: sharedComputerUseClient.getStatus(),
        doctor: null,
        error: getErrorMessage(error, 'Failed to load Computer Use status'),
      })
    }
    return true
  }

  if (disabled) {
    setJson(res, 503, { error: 'Computer Use bridge is disabled' })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/computer-use/tools') {
    try {
      setJson(res, 200, { tools: await sharedComputerUseClient.listTools() })
    } catch (error) {
      setJson(res, 503, { error: getErrorMessage(error, 'Failed to list Computer Use tools') })
    }
    return true
  }

  const toolName = readOnlyToolByPath[url.pathname]
  if (toolName) {
    if (req.method !== 'POST' && !['/codex-api/computer-use/apps', '/codex-api/computer-use/windows'].includes(url.pathname)) {
      setJson(res, 405, { error: 'Method not allowed' })
      return true
    }
    if (req.method !== 'GET' && ['/codex-api/computer-use/apps', '/codex-api/computer-use/windows'].includes(url.pathname)) {
      setJson(res, 405, { error: 'Method not allowed' })
      return true
    }

    try {
      const payload = req.method === 'POST' ? asRecord(await context.readJsonBody(req)) : {}
      setJson(res, 200, await sharedComputerUseClient.callTool(toolName, payload))
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, `Failed to call Computer Use tool: ${toolName}`) })
    }
    return true
  }

  setJson(res, 404, { error: 'Unknown Computer Use route' })
  return true
}
