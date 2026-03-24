import { realpathSync } from 'fs'
import { isAbsolute, normalize, relative, resolve } from 'path'

const LOCAL_ASSET_PREFIX = 'local-asset://image/'
const LOCAL_ASSET_FALLBACK_PREFIX = 'local-asset://'

export interface LocalAssetResolverDeps {
  realpathSync: (filePath: string) => string
  platform: NodeJS.Platform
}

function normalizeResolvedPath(filePath: string): string {
  return resolve(normalize(filePath))
}

function normalizeComparisonPath(filePath: string, platform: NodeJS.Platform): string {
  const normalized = normalizeResolvedPath(filePath)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function tryResolveRealPath(
  filePath: string,
  realpathResolver: LocalAssetResolverDeps['realpathSync']
): string {
  try {
    return normalizeResolvedPath(realpathResolver(filePath))
  } catch {
    return normalizeResolvedPath(filePath)
  }
}

function isPathWithinDirectory(
  directoryPath: string,
  targetPath: string,
  platform: NodeJS.Platform
): boolean {
  const normalizedDirectory = normalizeComparisonPath(directoryPath, platform)
  const normalizedTarget = normalizeComparisonPath(targetPath, platform)

  if (normalizedTarget === normalizedDirectory) {
    return true
  }

  const relativePath = relative(normalizedDirectory, normalizedTarget)
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function extractEncodedPath(requestUrl: string): string | null {
  if (requestUrl.startsWith(LOCAL_ASSET_PREFIX)) {
    return requestUrl.slice(LOCAL_ASSET_PREFIX.length)
  }

  if (requestUrl.startsWith(LOCAL_ASSET_FALLBACK_PREFIX)) {
    return requestUrl.slice(LOCAL_ASSET_FALLBACK_PREFIX.length)
  }

  return null
}

export function resolveLocalAssetPath(
  requestUrl: string,
  outputDirectory: string | null | undefined,
  deps: Partial<LocalAssetResolverDeps> = {}
): string | null {
  if (!outputDirectory?.trim()) {
    return null
  }

  const encodedPath = extractEncodedPath(requestUrl)
  if (!encodedPath) {
    return null
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return null
  }

  const realpathResolver = deps.realpathSync ?? realpathSync.native
  const platform = deps.platform ?? process.platform
  const resolvedOutputDirectory = tryResolveRealPath(outputDirectory, realpathResolver)
  const resolvedTargetPath = tryResolveRealPath(decodedPath, realpathResolver)

  if (!isPathWithinDirectory(resolvedOutputDirectory, resolvedTargetPath, platform)) {
    return null
  }

  return resolvedTargetPath
}
