import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const WORKTREE_ENV_CONFIG_KEY = 'codex.localEnvironmentConfigPath'
const NO_LOCAL_ENVIRONMENT_CONFIG = '__none__'
const SHELL_ENVIRONMENT_FILENAME = 'codex-shell-environment.json'
const SOURCE_TREE_ENV = 'CODEX_SOURCE_TREE_PATH'
const WORKTREE_PATH_ENV = 'CODEX_WORKTREE_PATH'
const LOCAL_ENV_SETUP_TIMEOUT_MS = 10 * 60 * 1000

type PlatformName = 'darwin' | 'linux' | 'win32'

type LocalEnvironmentScript = {
  script: string
  darwin?: { script: string }
  linux?: { script: string }
  win32?: { script: string }
}

type LocalEnvironmentConfig = {
  configPath: string
  name: string
  cwdRelativeToGitRoot: string
  setup: LocalEnvironmentScript
}

export type ManagedWorktreeLocalEnvironmentSetupResult = {
  cwd: string
  scriptPath: string
  status: 'succeeded'
  startedAt: number
  finishedAt: number
  log: string
}

export type ApplyManagedWorktreeLocalEnvironmentResult = {
  localEnvironmentConfigPath: string | null
  setupResult: ManagedWorktreeLocalEnvironmentSetupResult | null
}

export async function applyManagedWorktreeLocalEnvironment(input: {
  sourceWorkspaceRoot: string
  sourceGitRoot: string
  worktreeGitRoot: string
  worktreeWorkspaceRoot: string
  localEnvironmentConfigPath?: string | null
}): Promise<ApplyManagedWorktreeLocalEnvironmentResult> {
  const configPath = normalizeConfigPath(input.localEnvironmentConfigPath, input.sourceWorkspaceRoot)
  await storeSelectedLocalEnvironmentConfig(input.worktreeWorkspaceRoot, configPath ?? NO_LOCAL_ENVIRONMENT_CONFIG)
  if (!configPath) {
    await removeShellEnvironment(input.worktreeGitRoot)
    return { localEnvironmentConfigPath: null, setupResult: null }
  }

  const config = await readLocalEnvironmentConfig(configPath, input.sourceGitRoot)
  const setupScript = selectSetupScript(config.setup, process.platform)
  if (!setupScript) {
    await removeShellEnvironment(input.worktreeGitRoot)
    return { localEnvironmentConfigPath: configPath, setupResult: null }
  }

  const setupCwd = resolveWorktreeSetupCwd(input.worktreeGitRoot, config.cwdRelativeToGitRoot)
  const setupResult = await runSetupScript({
    configPath,
    cwd: setupCwd,
    script: setupScript,
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    worktreeWorkspaceRoot: input.worktreeWorkspaceRoot,
  })
  await writeShellEnvironment(input.worktreeGitRoot, setupResult.shellEnvironment)

  return {
    localEnvironmentConfigPath: configPath,
    setupResult: setupResult.result,
  }
}

function normalizeConfigPath(configPath: string | null | undefined, sourceWorkspaceRoot: string): string | null {
  const trimmed = configPath?.trim()
  if (!trimmed) return null
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(sourceWorkspaceRoot, trimmed)
}

async function storeSelectedLocalEnvironmentConfig(worktreeWorkspaceRoot: string, configPath: string): Promise<void> {
  const args = ['config', '--worktree', WORKTREE_ENV_CONFIG_KEY, configPath]
  try {
    await runGit(worktreeWorkspaceRoot, args)
  } catch (error) {
    if (!isWorktreeConfigUnsupportedError(error)) throw error
    await runGit(worktreeWorkspaceRoot, ['config', 'extensions.worktreeConfig', 'true'])
    await runGit(worktreeWorkspaceRoot, args)
  }
}

async function readLocalEnvironmentConfig(configPath: string, sourceGitRoot: string): Promise<LocalEnvironmentConfig> {
  let parsed: Record<string, unknown>
  try {
    parsed = parseLocalEnvironmentToml(await readFile(configPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to parse environment config at ${configPath}: ${formatErrorMessage(error)}`)
  }

  const version = typeof parsed.version === 'number' ? parsed.version : 1
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  const setup = parsed.setup
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid environment config at ${configPath}: version must be a positive integer`)
  }
  if (!name) {
    throw new Error(`Invalid environment config at ${configPath}: name is required`)
  }
  if (!isLocalEnvironmentScript(setup)) {
    throw new Error(`Invalid environment config at ${configPath}: setup.script is required`)
  }

  return {
    configPath,
    name,
    cwdRelativeToGitRoot: await resolveCwdRelativeToGitRoot(configPath, sourceGitRoot),
    setup: normalizeLocalEnvironmentScript(setup),
  }
}

function parseLocalEnvironmentToml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let tablePath: string[] = []
  const lines = raw.split(/\r?\n/u)
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let line = stripTomlComment(lines[lineIndex] ?? '').trim()
    if (!line) continue

    const tableMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(line)
    if (tableMatch) {
      tablePath = tableMatch[1].split('.')
      ensureTomlTable(root, tablePath)
      continue
    }

    const assignmentMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(line)
    if (!assignmentMatch) continue
    const key = assignmentMatch[1]
    let value = assignmentMatch[2].trim()
    const multilineDelimiter = value.startsWith('"""') ? '"""' : value.startsWith("'''") ? "'''" : null
    if (multilineDelimiter && !endsWithTomlMultilineDelimiter(value, multilineDelimiter)) {
      const collected = [value]
      while (lineIndex + 1 < lines.length) {
        lineIndex += 1
        collected.push(lines[lineIndex] ?? '')
        if (endsWithTomlMultilineDelimiter(lines[lineIndex] ?? '', multilineDelimiter)) break
      }
      value = collected.join('\n')
    }
    const table = ensureTomlTable(root, tablePath)
    table[key] = readTomlValue(value)
  }
  return root
}

function stripTomlComment(value: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"' && !escaped && char === '\\') {
      escaped = true
      continue
    }
    if (!escaped && (char === '"' || char === "'")) {
      quote = quote === char ? null : quote ?? char
      continue
    }
    if (!quote && char === '#') return value.slice(0, index)
    escaped = false
  }
  return value
}

function endsWithTomlMultilineDelimiter(value: string, delimiter: '"""' | "'''"): boolean {
  const trimmed = value.trimEnd()
  return trimmed.length > delimiter.length && trimmed.endsWith(delimiter)
}

function ensureTomlTable(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let cursor = root
  for (const segment of path) {
    const current = cursor[segment]
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      cursor = current as Record<string, unknown>
      continue
    }
    const next: Record<string, unknown> = {}
    cursor[segment] = next
    cursor = next
  }
  return cursor
}

function readTomlValue(value: string): unknown {
  const trimmed = value.trim()
  const multilineDelimiter = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null
  if (multilineDelimiter && trimmed.endsWith(multilineDelimiter)) {
    let content = trimmed.slice(multilineDelimiter.length, -multilineDelimiter.length)
    if (content.startsWith('\n')) content = content.slice(1)
    if (content.endsWith('\n')) content = content.slice(0, -1)
    return multilineDelimiter === '"""' ? unescapeTomlBasicString(content) : content
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return unescapeTomlBasicString(trimmed.slice(1, -1))
      }
    }
    return trimmed.slice(1, -1)
  }
  if (/^[+-]?\d+$/u.test(trimmed)) return Number(trimmed)
  return trimmed
}

function unescapeTomlBasicString(value: string): string {
  return value.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([btnfr"\\]))/gu, (match, shortHex: string | undefined, longHex: string | undefined, escaped: string | undefined) => {
    if (shortHex || longHex) {
      const codePoint = Number.parseInt(shortHex ?? longHex ?? '', 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    switch (escaped) {
      case 'b': return '\b'
      case 't': return '\t'
      case 'n': return '\n'
      case 'f': return '\f'
      case 'r': return '\r'
      case '"': return '"'
      case '\\': return '\\'
      default: return match
    }
  })
}

function isLocalEnvironmentScript(value: unknown): value is LocalEnvironmentScript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const script = (value as { script?: unknown }).script
  return typeof script === 'string' && script.trim().length > 0
}

function normalizeLocalEnvironmentScript(value: LocalEnvironmentScript): LocalEnvironmentScript {
  return {
    script: value.script.trim(),
    darwin: normalizePlatformScript(value.darwin),
    linux: normalizePlatformScript(value.linux),
    win32: normalizePlatformScript(value.win32),
  }
}

function normalizePlatformScript(value: unknown): { script: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const script = (value as { script?: unknown }).script
  return typeof script === 'string' && script.trim() ? { script: script.trim() } : undefined
}

function selectSetupScript(setup: LocalEnvironmentScript, platform: NodeJS.Platform): string | null {
  const platformName = platform === 'darwin' || platform === 'win32' ? platform : 'linux'
  return setup[platformName as PlatformName]?.script || setup.script || null
}

async function resolveCwdRelativeToGitRoot(configPath: string, sourceGitRoot: string): Promise<string> {
  const anchor = await findNearestLocalEnvironmentAnchor(dirname(configPath))
  const relativePath = relative(sourceGitRoot, anchor ?? dirname(configPath))
  if (!relativePath || relativePath === '') return '.'
  if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath)) return '.'
  return relativePath
}

async function findNearestLocalEnvironmentAnchor(startDir: string): Promise<string | null> {
  let current = resolve(startDir)
  while (true) {
    if (await pathExists(join(current, '.codex')) || await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function resolveWorktreeSetupCwd(worktreeGitRoot: string, cwdRelativeToGitRoot: string): string {
  return cwdRelativeToGitRoot === '.' ? worktreeGitRoot : join(worktreeGitRoot, cwdRelativeToGitRoot)
}

async function runSetupScript(input: {
  configPath: string
  cwd: string
  script: string
  sourceWorkspaceRoot: string
  worktreeWorkspaceRoot: string
}): Promise<{
  result: ManagedWorktreeLocalEnvironmentSetupResult
  shellEnvironment: { version: 1; set: Record<string, string>; exclude: string[] }
}> {
  const startedAt = Date.now()
  const tempDir = join(tmpdir(), `codexui-local-env-${randomUUID()}`)
  const capturedEnvPath = join(tempDir, 'captured-env.json')
  const scriptPath = join(tempDir, `setup.${process.platform === 'win32' ? 'cmd' : 'sh'}`)
  await mkdir(tempDir, { recursive: true })
  try {
    const wrapper = buildSetupWrapper(input.script, capturedEnvPath)
    await writeFile(scriptPath, wrapper, 'utf8')
    const env = {
      ...process.env,
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      TERM: process.env.TERM || 'xterm-256color',
      [SOURCE_TREE_ENV]: input.sourceWorkspaceRoot,
      [WORKTREE_PATH_ENV]: input.worktreeWorkspaceRoot,
    }
    const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || 'sh')
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', scriptPath] : ['-lc', `sh ${shellQuote(scriptPath)}`]
    const { stdout, stderr } = await execFileAsync(shell, args, {
      cwd: input.cwd,
      env,
      timeout: LOCAL_ENV_SETUP_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    })
    const finishedAt = Date.now()
    const captured = await readCapturedEnvironment(capturedEnvPath)
    return {
      result: {
        cwd: input.cwd,
        scriptPath: input.configPath,
        status: 'succeeded',
        startedAt,
        finishedAt,
        log: [stdout, stderr].filter(Boolean).join('\n'),
      },
      shellEnvironment: diffShellEnvironment(env, captured),
    }
  } catch (error) {
    throw new Error(`Setup script failed: ${formatErrorMessage(error)}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`
}

function buildSetupWrapper(script: string, capturedEnvPath: string): string {
  if (process.platform === 'win32') {
    return `${script}\r\nif %ERRORLEVEL% EQU 0 node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify(process.env))" "${capturedEnvPath}"\r\nexit /b %ERRORLEVEL%\r\n`
  }
  return `${script.replace(/\r\n/gu, '\n')}\nsetup_exit_code=$?\nif [ "$setup_exit_code" -eq 0 ]; then\n  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.env))' '${capturedEnvPath.replace(/'/gu, "'\\''")}'\nfi\nexit "$setup_exit_code"\n`
}

async function readCapturedEnvironment(path: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') env[key] = value
    }
    return env
  } catch {
    return {}
  }
}

function diffShellEnvironment(before: NodeJS.ProcessEnv, after: Record<string, string>): { version: 1; set: Record<string, string>; exclude: string[] } {
  const set: Record<string, string> = {}
  const exclude: string[] = []
  for (const [key, value] of Object.entries(after)) {
    if (shouldIgnoreShellEnvironmentKey(key)) continue
    if (before[key] !== value) set[key] = value
  }
  for (const key of Object.keys(before)) {
    if (shouldIgnoreShellEnvironmentKey(key)) continue
    if (!(key in after)) exclude.push(key)
  }
  return { version: 1, set, exclude }
}

function shouldIgnoreShellEnvironmentKey(key: string): boolean {
  return new Set([
    SOURCE_TREE_ENV,
    WORKTREE_PATH_ENV,
    'CODEX_SETUP_EXIT_CODE',
    'OLDPWD',
    'PWD',
    'SHELLOPTS',
    'SHLVL',
    '_',
  ]).has(process.platform === 'win32' ? key.toUpperCase() : key)
}

async function writeShellEnvironment(worktreeGitRoot: string, shellEnvironment: { version: 1; set: Record<string, string>; exclude: string[] }): Promise<void> {
  const path = await resolveGitPath(worktreeGitRoot, SHELL_ENVIRONMENT_FILENAME)
  if (!path) return
  await writeFile(path, `${JSON.stringify(shellEnvironment, null, 2)}\n`, 'utf8')
}

async function removeShellEnvironment(worktreeGitRoot: string): Promise<void> {
  const path = await resolveGitPath(worktreeGitRoot, SHELL_ENVIRONMENT_FILENAME)
  if (path) await rm(path, { force: true }).catch(() => {})
}

async function resolveGitPath(cwd: string, path: string): Promise<string | null> {
  try {
    const gitPath = (await runGit(cwd, ['rev-parse', '--git-path', path])).trim()
    return isAbsolute(gitPath) ? gitPath : join(cwd, gitPath)
  } catch {
    return null
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

function isWorktreeConfigUnsupportedError(error: unknown): boolean {
  const text = formatErrorMessage(error).toLowerCase()
  return text.includes('worktreeconfig')
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as Error & { stderr?: unknown }).stderr
    return typeof stderr === 'string' && stderr.trim() ? stderr.trim() : error.message
  }
  return String(error)
}
