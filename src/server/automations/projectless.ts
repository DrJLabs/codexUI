import { mkdir, lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_PROJECTLESS_DIRECTORY_ATTEMPTS = 100
const MAX_PROJECTLESS_SLUG_LENGTH = 80

export type ProjectlessAutomationWorkspace = {
  cwd: string
  outputDirectory: string
  workspaceRoot: string
}

export function isProjectlessCwd(cwd: string | null | undefined): boolean {
  return cwd?.trim() === '~'
}

export async function createProjectlessAutomationWorkspace(input: {
  prompt: string
  homeDir?: string | null
  now?: Date
}): Promise<ProjectlessAutomationWorkspace> {
  const workspaceRoot = join(input.homeDir?.trim() || homedir(), 'Documents', 'Codex')
  await mkdir(workspaceRoot, { recursive: true })
  await assertRealDirectory(workspaceRoot, 'Projectless workspace root must be a real directory')

  const dayRoot = join(workspaceRoot, formatProjectlessDate(input.now ?? new Date()))
  await mkdir(dayRoot, { recursive: true })
  await assertRealDirectory(dayRoot, 'Projectless day directory must be a real directory')

  const slug = slugifyProjectlessPrompt(input.prompt)
  for (let index = 0; index < MAX_PROJECTLESS_DIRECTORY_ATTEMPTS; index += 1) {
    const cwd = join(dayRoot, index === 0 ? slug : `${slug}-${index + 1}`)
    try {
      await mkdir(cwd, { recursive: false })
      return { cwd, outputDirectory: cwd, workspaceRoot }
    } catch (error) {
      try {
        await assertRealDirectory(cwd, 'Projectless thread directory must be a real directory')
      } catch {
        throw error
      }
    }
  }
  throw new Error('Unable to create a unique projectless thread directory')
}

export function buildProjectlessAutomationInstructions(outputDirectory: string): string {
  return [
    '### Projectless Chat',
    "- This projectless thread starts in a generated directory under the user's Documents/Codex folder",
    '- Prefer answering inline in chat unless using local files would make the result more useful',
    `- When using local files for this thread, put them in ${outputDirectory}`,
  ].join('\n')
}

function slugifyProjectlessPrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.slice(0, 6)
    .join('-')
    .slice(0, MAX_PROJECTLESS_SLUG_LENGTH) || 'new-chat'
}

function formatProjectlessDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function assertRealDirectory(path: string, message: string): Promise<void> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(message)
}
