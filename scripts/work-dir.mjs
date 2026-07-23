import path from 'node:path'

export function resolveWorkDir(rootDir) {
  const configuredDir = process.env.HUNT_PLANNER_WORK_DIR?.trim()

  return configuredDir
    ? path.resolve(rootDir, configuredDir)
    : path.join(rootDir, 'work')
}
