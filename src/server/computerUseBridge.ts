import { accessSync, constants } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

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

export async function handleComputerUseRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _context: ComputerUseRouteContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/codex-api/computer-use')) return false

  res.statusCode = 501
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: 'Computer Use bridge is not implemented yet' }))
  return true
}
