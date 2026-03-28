import { realpathSync } from 'fs'
import { isAbsolute, normalize, relative, resolve } from 'path'
import { resolveConfiguredOutputRoot, type OutputRootSettings } from '../output-root'

const LOCAL_ASSET_PREFIX = 'local-asset://image/'
const LOCAL_ASSET_FALLBACK_PREFIX = 'local-asset://'

export interface LocalAssetResolverDeps {
  realpathSync: (filePath: string) => string
  platform: NodeJS.Platform
  isTrackedAssetPath: (candidatePaths: readonly string[]) => boolean
}

export interface LocalAssetRequestHandlerDeps {
  outputDirectory: string | null | undefined
  fetchAsset: (filePath: string) => Response | Promise<Response>
  resolverDeps?: Partial<LocalAssetResolverDeps>
}

export interface LocalAssetSettingsRequestHandlerDeps {
  settings: OutputRootSettings
  fallbackRoot?: string
  fetchAsset: (filePath: string) => Response | Promise<Response>
  resolverDeps?: Partial<LocalAssetResolverDeps>
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

function resolveAllowedAssetPath(
  filePath: string,
  outputDirectory: string | null | undefined,
  deps: Partial<LocalAssetResolverDeps> = {}
): string | null {
  const realpathResolver = deps.realpathSync ?? realpathSync.native
  const platform = deps.platform ?? process.platform
  const normalizedRequestedPath = normalizeResolvedPath(filePath)
  const resolvedTargetPath = tryResolveRealPath(filePath, realpathResolver)

  if (outputDirectory?.trim()) {
    const resolvedOutputDirectory = tryResolveRealPath(outputDirectory, realpathResolver)

    if (isPathWithinDirectory(resolvedOutputDirectory, resolvedTargetPath, platform)) {
      return resolvedTargetPath
    }
  }

  const trackedAssetCandidates = Array.from(
    new Set([normalizedRequestedPath, resolvedTargetPath].filter(Boolean))
  )

  if (deps.isTrackedAssetPath?.(trackedAssetCandidates)) {
    return resolvedTargetPath
  }

  return null
}

export function resolveLocalAssetPath(
  requestUrl: string,
  outputDirectory: string | null | undefined,
  deps: Partial<LocalAssetResolverDeps> = {}
): string | null {
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

  return resolveAllowedAssetPath(decodedPath, outputDirectory, deps)
}

export function resolveDirectAssetPath(
  filePath: string,
  outputDirectory: string | null | undefined,
  deps: Partial<LocalAssetResolverDeps> = {}
): string | null {
  if (!isAbsolute(filePath)) {
    return null
  }

  return resolveAllowedAssetPath(filePath, outputDirectory, deps)
}

export function handleLocalAssetRequest(
  requestUrl: string,
  deps: LocalAssetRequestHandlerDeps
): Response | Promise<Response> {
  const filePath = resolveLocalAssetPath(requestUrl, deps.outputDirectory, deps.resolverDeps)

  if (!filePath) {
    return new Response('Forbidden', { status: 403 })
  }

  return deps.fetchAsset(filePath)
}

export function resolveDirectAssetPathFromSettings(
  filePath: string,
  deps: Pick<LocalAssetSettingsRequestHandlerDeps, 'settings' | 'fallbackRoot' | 'resolverDeps'>
): string | null {
  return resolveDirectAssetPath(
    filePath,
    resolveConfiguredOutputRoot(deps.settings, deps.fallbackRoot),
    deps.resolverDeps
  )
}

export function handleLocalAssetRequestFromSettings(
  requestUrl: string,
  deps: LocalAssetSettingsRequestHandlerDeps
): Response | Promise<Response> {
  return handleLocalAssetRequest(requestUrl, {
    outputDirectory: resolveConfiguredOutputRoot(deps.settings, deps.fallbackRoot),
    fetchAsset: deps.fetchAsset,
    resolverDeps: deps.resolverDeps
  })
}
