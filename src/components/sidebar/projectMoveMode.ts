export type ProjectMoveModeState = {
  isActive: boolean
  projectName: string
}

export function stopProjectMoveMode(): ProjectMoveModeState {
  return {
    isActive: false,
    projectName: '',
  }
}

export function createProjectMoveModeState(projectNames: string[], projectName: string): ProjectMoveModeState {
  const normalizedProjectName = projectName.trim()
  if (!normalizedProjectName || !projectNames.includes(normalizedProjectName)) {
    return stopProjectMoveMode()
  }

  return {
    isActive: true,
    projectName: normalizedProjectName,
  }
}
