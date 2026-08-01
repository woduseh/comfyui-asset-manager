import path from 'path'

export interface PathOperations {
  resolve(...paths: string[]): string
  relative(from: string, to: string): string
  isAbsolute(path: string): boolean
  basename(path: string): string
  sep: string
}

function isPathWithinRoot(
  rootPath: string,
  candidatePath: string,
  pathOps: PathOperations
): boolean {
  const relative = pathOps.relative(rootPath, candidatePath)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${pathOps.sep}`) && !pathOps.isAbsolute(relative))
  )
}

export function resolveSafeOutputDirectory(
  outputRoot: string,
  relativePath: string,
  pathOps: PathOperations = path
): string {
  const resolvedRoot = pathOps.resolve(outputRoot)
  const resolvedDirectory = pathOps.resolve(resolvedRoot, relativePath)
  if (!isPathWithinRoot(resolvedRoot, resolvedDirectory, pathOps)) {
    throw new Error('Output folder pattern resolves outside the configured output directory')
  }
  return resolvedDirectory
}

export function resolveSafeOutputFile(
  outputRoot: string,
  outputDirectory: string,
  fileName: string,
  pathOps: PathOperations = path
): string {
  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    pathOps.basename(fileName) !== fileName
  ) {
    throw new Error('Output filename pattern must resolve to a filename without directories')
  }

  const resolvedRoot = pathOps.resolve(outputRoot)
  const resolvedFile = pathOps.resolve(outputDirectory, fileName)
  if (!isPathWithinRoot(resolvedRoot, resolvedFile, pathOps)) {
    throw new Error('Output filename resolves outside the configured output directory')
  }
  return resolvedFile
}
