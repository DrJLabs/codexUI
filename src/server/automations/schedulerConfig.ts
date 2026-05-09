import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

export type AutomationSchedulerPreference = {
  enabled: boolean
  shouldRun: () => boolean
  readStatus: () => {
    mode: 'desktop' | 'codexui' | 'disabled'
    desktopDetected: boolean
    detectionSupported: boolean
  }
}

export type CodexDesktopProcessDetectorOptions = {
  cacheTtlMs?: number
  now?: () => number
  platform?: NodeJS.Platform
  scanProcesses?: (platform: NodeJS.Platform) => Iterable<string>
}

const CODEX_DESKTOP_DETECTION_CACHE_TTL_MS = 10_000
const CODEX_DESKTOP_PROCESS_SCAN_TIMEOUT_MS = 1_500

export function resolveAutomationSchedulerPreference(
  env: NodeJS.ProcessEnv = process.env,
  isDesktopActive: () => boolean = detectCodexDesktopProcess,
  canDetectDesktop: () => boolean = canDetectCodexDesktopProcess,
): AutomationSchedulerPreference {
  const setting = readSchedulerSetting(env)
  if (setting === 'enabled') return {
    enabled: true,
    shouldRun: () => true,
    readStatus: () => ({ mode: 'codexui', desktopDetected: false, detectionSupported: canDetectDesktop() }),
  }
  if (setting === 'disabled') return {
    enabled: false,
    shouldRun: () => false,
    readStatus: () => ({ mode: 'desktop', desktopDetected: false, detectionSupported: canDetectDesktop() }),
  }
  if (!canDetectDesktop()) return {
    enabled: false,
    shouldRun: () => false,
    readStatus: () => ({ mode: 'disabled', desktopDetected: false, detectionSupported: false }),
  }
  return {
    enabled: true,
    shouldRun: () => {
      try {
        return !isDesktopActive()
      } catch {
        return false
      }
    },
    readStatus: () => {
      try {
        const desktopDetected = isDesktopActive()
        return {
          mode: desktopDetected ? 'desktop' : 'codexui',
          desktopDetected,
          detectionSupported: true,
        }
      } catch {
        return { mode: 'desktop', desktopDetected: true, detectionSupported: true }
      }
    },
  }
}

function readSchedulerSetting(env: NodeJS.ProcessEnv): 'auto' | 'enabled' | 'disabled' {
  const raw = env.CODEXUI_AUTOMATIONS_SCHEDULER ?? env.CODEXUI_ENABLE_AUTOMATION_SCHEDULER ?? 'desktop'
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable', 'codexui'].includes(normalized)) return 'enabled'
  if (['0', 'false', 'no', 'off', 'disabled', 'disable', 'desktop'].includes(normalized)) return 'disabled'
  if (['auto', 'best-effort'].includes(normalized)) return 'auto'
  return 'disabled'
}

const defaultCodexDesktopProcessDetector = createCodexDesktopProcessDetector()

export function detectCodexDesktopProcess(): boolean {
  return defaultCodexDesktopProcessDetector()
}

export function createCodexDesktopProcessDetector(
  options: CodexDesktopProcessDetectorOptions = {},
): () => boolean {
  let cached: { platform: NodeJS.Platform; detected: boolean; timestampMs: number } | null = null
  const cacheTtlMs = options.cacheTtlMs ?? CODEX_DESKTOP_DETECTION_CACHE_TTL_MS

  return () => {
    const platform = options.platform ?? process.platform
    if (!canDetectCodexDesktopProcess(platform)) return false

    const now = options.now?.() ?? Date.now()
    if (cached && cached.platform === platform && now >= cached.timestampMs && now - cached.timestampMs < cacheTtlMs) {
      return cached.detected
    }

    const detected = scanForCodexDesktopProcess(platform, options.scanProcesses)
    cached = { platform, detected, timestampMs: now }
    return detected
  }
}

export function canDetectCodexDesktopProcess(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux' || platform === 'darwin' || platform === 'win32'
}

function scanForCodexDesktopProcess(
  platform: NodeJS.Platform,
  scanProcesses: ((platform: NodeJS.Platform) => Iterable<string>) | undefined,
): boolean {
  try {
    const processLines = scanProcesses?.(platform) ?? scanPlatformProcessLines(platform)
    for (const processLine of processLines) {
      if (isCodexDesktopProcessLine(processLine)) return true
    }
  } catch {
    return true
  }
  return false
}

function scanPlatformProcessLines(platform: NodeJS.Platform): string[] {
  if (platform === 'linux') return scanLinuxProcessLines()
  if (platform === 'darwin') return scanDarwinProcessLines()
  if (platform === 'win32') return scanWindowsProcessLines()
  return []
}

function scanLinuxProcessLines(): string[] {
  const processLines: string[] = []
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${entry.name}/cmdline`, 'utf8').replace(/\0/g, ' ')
    } catch {
      continue
    }
    const processHints = [cmdline]
    try {
      const environ = readFileSync(`/proc/${entry.name}/environ`, 'utf8').replace(/\0/g, ' ')
      if (hasElectronOrCodexExecutableHint(cmdline)) processHints.push(environ)
    } catch {
      // Environment is a secondary hint; permission failures should not block cmdline detection.
    }
    processLines.push(processHints.join(' '))
  }
  return processLines
}

function scanDarwinProcessLines(): string[] {
  return execFileSync('/bin/ps', ['-axo', 'command='], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: CODEX_DESKTOP_PROCESS_SCAN_TIMEOUT_MS,
  }).split(/\r?\n/)
}

function scanWindowsProcessLines(): string[] {
  return execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.Name)`t$($_.ExecutablePath)`t$($_.CommandLine)" }',
  ], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: CODEX_DESKTOP_PROCESS_SCAN_TIMEOUT_MS,
    windowsHide: true,
  }).split(/\r?\n/)
}

function hasElectronOrCodexExecutableHint(processLine: string): boolean {
  const normalized = processLine.replace(/\0/g, ' ').trim().toLowerCase()
  return /(^|[\s"'])(?:[a-z]:[\\/][^\t\r\n]*[\\/])?(?:[^\\/:"'\s]+[\\/])*(electron|codex(?:\.exe)?)(?=$|[\s"'])/.test(normalized) ||
    normalized.includes('codex.app/contents/macos/codex')
}

function isCodexDesktopProcessLine(processLine: string): boolean {
  const normalized = processLine.replace(/\0/g, ' ').trim().toLowerCase()
  if (!normalized) return false

  if (normalized.includes('/opt/codex-desktop/electron')) return true
  if (hasElectronOrCodexExecutableHint(normalized) && normalized.includes('codex_electron_resources_path')) return true
  if (normalized.includes('--app-id=codex-desktop')) return true
  if (
    hasElectronOrCodexExecutableHint(normalized) &&
    /(^|[\s"'=:/\\])codex-desktop($|[\s"':/\\.-])/.test(normalized)
  ) {
    return true
  }
  if (normalized.includes('codex.app/contents/macos/codex')) return true
  if (
    /(^|[\s"'=:/\\])codex\.exe($|[\s"':/\\])/.test(normalized) &&
    (normalized.includes('\\programs\\codex\\') || normalized.includes('\\codex\\resources\\') || normalized.includes('/codex/resources/'))
  ) {
    return true
  }
  if (/codex(?: desktop|\.app)?[^\r\n]{0,160}resources[\\/]+app\.asar/.test(normalized)) return true
  if (/resources[\\/]+app\.asar[^\r\n]{0,160}codex(?: desktop|\.app)?/.test(normalized)) return true
  if (/(originator|user-agent)[^\r\n]{0,64}codex desktop/.test(normalized)) return true
  if (/codex desktop[^\r\n]{0,64}(originator|user-agent)/.test(normalized)) return true

  return false
}
