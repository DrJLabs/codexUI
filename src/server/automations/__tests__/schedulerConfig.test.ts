import { describe, expect, it } from 'vitest'
import {
  canDetectCodexDesktopProcess,
  createCodexDesktopProcessDetector,
  resolveAutomationSchedulerPreference,
} from '../schedulerConfig'

describe('resolveAutomationSchedulerPreference', () => {
  it('defaults to Desktop scheduler ownership when no env setting is provided', () => {
    const preference = resolveAutomationSchedulerPreference({}, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
    expect(preference.readStatus()).toEqual({
      mode: 'desktop',
      desktopDetected: false,
      detectionSupported: true,
    })
  })

  it('supports explicit best-effort auto mode when no Codex desktop process is active', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'auto',
    }, () => false, () => true)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(true)
    expect(preference.readStatus()).toEqual({
      mode: 'codexui',
      desktopDetected: false,
      detectionSupported: true,
    })
  })

  it('pauses scheduler ticks in explicit auto mode while Codex desktop is active', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'auto',
    }, () => true, () => true)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(false)
    expect(preference.readStatus()).toEqual({
      mode: 'desktop',
      desktopDetected: true,
      detectionSupported: true,
    })
  })

  it('keeps explicit auto mode disabled when Desktop process detection is unsupported', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'auto',
    }, () => false, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
    expect(preference.readStatus()).toEqual({
      mode: 'disabled',
      desktopDetected: false,
      detectionSupported: false,
    })
  })

  it('pauses explicit auto mode when Desktop process detection fails', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'auto',
    }, () => {
      throw new Error('process scan failed')
    }, () => true)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(false)
    expect(preference.readStatus()).toEqual({
      mode: 'desktop',
      desktopDetected: true,
      detectionSupported: true,
    })
  })

  it('lets explicit enabled override desktop detection', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'enabled',
    }, () => true)

    expect(preference.enabled).toBe(true)
    expect(preference.shouldRun()).toBe(true)
    expect(preference.readStatus()).toEqual({
      mode: 'codexui',
      desktopDetected: false,
      detectionSupported: true,
    })
  })

  it('disables the scheduler when the env setting selects desktop ownership', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'desktop',
    }, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
    expect(preference.readStatus()).toEqual({
      mode: 'desktop',
      desktopDetected: false,
      detectionSupported: true,
    })
  })

  it('disables the scheduler for unknown values instead of guessing ownership', () => {
    const preference = resolveAutomationSchedulerPreference({
      CODEXUI_AUTOMATIONS_SCHEDULER: 'maybe',
    }, () => false)

    expect(preference.enabled).toBe(false)
    expect(preference.shouldRun()).toBe(false)
    expect(preference.readStatus()).toEqual({
      mode: 'desktop',
      desktopDetected: false,
      detectionSupported: true,
    })
  })
})

describe('Codex Desktop process detection', () => {
  it('reports support for desktop process detection on Linux, macOS, and Windows only', () => {
    expect(canDetectCodexDesktopProcess('linux')).toBe(true)
    expect(canDetectCodexDesktopProcess('darwin')).toBe(true)
    expect(canDetectCodexDesktopProcess('win32')).toBe(true)
    expect(canDetectCodexDesktopProcess('freebsd')).toBe(false)
  })

  it('detects Linux Codex Desktop process markers from proc cmdlines', () => {
    const detector = createCodexDesktopProcessDetector({
      platform: 'linux',
      scanProcesses: () => [
        '/usr/bin/node /tmp/codexui/server.js',
        '/opt/codex-desktop/electron --app-id=codex-desktop CODEX_ELECTRON_RESOURCES_PATH=/opt/codex-desktop/resources',
      ],
    })

    expect(detector()).toBe(true)
  })

  it('detects Linux originator and Codex.app compatibility markers', () => {
    const originatorDetector = createCodexDesktopProcessDetector({
      platform: 'linux',
      scanProcesses: () => ['/usr/bin/electron --originator="Codex Desktop"'],
    })
    const appDetector = createCodexDesktopProcessDetector({
      platform: 'linux',
      scanProcesses: () => ['/Applications/Codex.app/Contents/MacOS/Codex --type=renderer'],
    })

    expect(originatorDetector()).toBe(true)
    expect(appDetector()).toBe(true)
  })

  it('does not treat inherited Codex Desktop env alone as an active Linux Desktop process', () => {
    const detector = createCodexDesktopProcessDetector({
      platform: 'linux',
      scanProcesses: () => ['/usr/bin/bash CODEX_ELECTRON_RESOURCES_PATH=/opt/codex-desktop/resources'],
    })

    expect(detector()).toBe(false)
  })

  it('detects macOS Codex.app and resources/app.asar process args', () => {
    const appDetector = createCodexDesktopProcessDetector({
      platform: 'darwin',
      scanProcesses: () => ['/Applications/Codex.app/Contents/MacOS/Codex --type=renderer'],
    })
    const asarDetector = createCodexDesktopProcessDetector({
      platform: 'darwin',
      scanProcesses: () => ['/Applications/Codex.app/Contents/Resources/app.asar --user-data-dir=/tmp/codex'],
    })

    expect(appDetector()).toBe(true)
    expect(asarDetector()).toBe(true)
  })

  it('detects Windows Codex.exe and Codex app resource paths', () => {
    const exeDetector = createCodexDesktopProcessDetector({
      platform: 'win32',
      scanProcesses: () => ['Codex.exe\tC:\\Users\\drj\\AppData\\Local\\Programs\\Codex\\Codex.exe\t"Codex.exe"'],
    })
    const resourceDetector = createCodexDesktopProcessDetector({
      platform: 'win32',
      scanProcesses: () => ['electron.exe\tC:\\Users\\drj\\AppData\\Local\\Programs\\Codex\\resources\\app.asar\t--app'],
    })

    expect(exeDetector()).toBe(true)
    expect(resourceDetector()).toBe(true)
  })

  it('does not treat a Windows Codex CLI process as Codex Desktop', () => {
    const detector = createCodexDesktopProcessDetector({
      platform: 'win32',
      scanProcesses: () => ['codex.exe\tC:\\Users\\drj\\AppData\\Roaming\\npm\\codex.exe\tcodex.exe serve'],
    })

    expect(detector()).toBe(false)
  })

  it('fails closed when a supported platform scan throws', () => {
    const detector = createCodexDesktopProcessDetector({
      platform: 'darwin',
      scanProcesses: () => {
        throw new Error('ps unavailable')
      },
    })

    expect(canDetectCodexDesktopProcess('darwin')).toBe(true)
    expect(detector()).toBe(true)
  })

  it('caches process detection results briefly', () => {
    let now = 1_000
    let scans = 0
    let commandLines = ['/Applications/Codex.app/Contents/MacOS/Codex']
    const detector = createCodexDesktopProcessDetector({
      platform: 'darwin',
      now: () => now,
      scanProcesses: () => {
        scans += 1
        return commandLines
      },
    })

    expect(detector()).toBe(true)
    commandLines = []
    expect(detector()).toBe(true)
    expect(scans).toBe(1)

    now += 10_001

    expect(detector()).toBe(false)
    expect(scans).toBe(2)
  })
})
