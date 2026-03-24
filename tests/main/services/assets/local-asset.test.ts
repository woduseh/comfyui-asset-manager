import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import {
  handleLocalAssetRequest,
  handleLocalAssetRequestFromSettings,
  resolveLocalAssetPath,
  type LocalAssetResolverDeps
} from '../../../../src/main/services/assets/local-asset'

function toLocalAssetUrl(filePath: string): string {
  return `local-asset://image/${encodeURIComponent(filePath)}`
}

describe('resolveLocalAssetPath', () => {
  const outputDirectory = resolve('tmp', 'generated')
  const directFile = join(outputDirectory, 'image.png')
  const nestedFile = join(outputDirectory, 'nested', 'image.png')
  const externalFile = resolve('tmp', 'external', 'secret.png')

  it('allows a file directly inside the configured output directory', () => {
    expect(resolveLocalAssetPath(toLocalAssetUrl(directFile), outputDirectory)).toBe(directFile)
  })

  it('allows a file inside a nested output subdirectory', () => {
    expect(resolveLocalAssetPath(toLocalAssetUrl(nestedFile), outputDirectory)).toBe(nestedFile)
  })

  it('rejects encoded traversal outside the output directory', () => {
    expect(
      resolveLocalAssetPath(toLocalAssetUrl(join('..', 'external', 'secret.png')), outputDirectory)
    ).toBeNull()
  })

  it('rejects an unrelated absolute path outside the output directory', () => {
    expect(resolveLocalAssetPath(toLocalAssetUrl(externalFile), outputDirectory)).toBeNull()
  })

  it('allows a tracked gallery asset path outside the current output directory', () => {
    const deps: Partial<LocalAssetResolverDeps> = {
      realpathSync: (filePath: string) => filePath,
      platform: process.platform,
      isTrackedAssetPath: (candidatePaths: readonly string[]) =>
        candidatePaths.includes(externalFile)
    }

    expect(resolveLocalAssetPath(toLocalAssetUrl(externalFile), outputDirectory, deps)).toBe(
      externalFile
    )
  })

  it('allows a tracked gallery asset path when output_directory is blank', () => {
    const deps: Partial<LocalAssetResolverDeps> = {
      realpathSync: (filePath: string) => filePath,
      platform: process.platform,
      isTrackedAssetPath: (candidatePaths: readonly string[]) =>
        candidatePaths.includes(externalFile)
    }

    expect(resolveLocalAssetPath(toLocalAssetUrl(externalFile), '', deps)).toBe(externalFile)
  })

  it('checks tracked gallery assets against both requested and resolved paths', () => {
    const aliasPath = resolve('tmp', 'external', 'tracked-alias.png')
    const canonicalPath = resolve('tmp', 'canonical', 'tracked.png')
    const deps: Partial<LocalAssetResolverDeps> = {
      realpathSync: (filePath: string) => (filePath === aliasPath ? canonicalPath : filePath),
      platform: process.platform,
      isTrackedAssetPath: (candidatePaths: readonly string[]) => candidatePaths.includes(aliasPath)
    }

    expect(resolveLocalAssetPath(toLocalAssetUrl(aliasPath), outputDirectory, deps)).toBe(
      canonicalPath
    )
  })

  it('rejects files whose realpath escapes the output directory', () => {
    const resolvedOutputDirectory = resolve(outputDirectory)
    const resolvedNestedFile = resolve(nestedFile)

    expect(
      resolveLocalAssetPath(toLocalAssetUrl(nestedFile), outputDirectory, {
        realpathSync: (filePath) => {
          if (filePath === resolvedOutputDirectory) {
            return resolvedOutputDirectory
          }

          if (filePath === resolvedNestedFile) {
            return externalFile
          }

          return filePath
        }
      })
    ).toBeNull()
  })

  describe('handleLocalAssetRequest', () => {
    it('fetches a tracked gallery asset outside the current output directory', async () => {
      const response = await handleLocalAssetRequest(toLocalAssetUrl(externalFile), {
        outputDirectory,
        fetchAsset: (filePath) => new Response(filePath, { status: 200 }),
        resolverDeps: {
          realpathSync: (filePath: string) => filePath,
          platform: process.platform,
          isTrackedAssetPath: (candidatePaths: readonly string[]) =>
            candidatePaths.includes(externalFile)
        }
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(externalFile)
    })

    it('returns 403 for an untracked asset outside the current output directory', async () => {
      let fetchCalled = false
      const response = await handleLocalAssetRequest(toLocalAssetUrl(externalFile), {
        outputDirectory,
        fetchAsset: () => {
          fetchCalled = true
          return new Response('unexpected', { status: 200 })
        },
        resolverDeps: {
          realpathSync: (filePath: string) => filePath,
          platform: process.platform,
          isTrackedAssetPath: () => false
        }
      })

      expect(response.status).toBe(403)
      expect(fetchCalled).toBe(false)
    })

    it('uses the legacy output.directory setting when resolving direct output-root access', async () => {
      const legacyOutputDirectory = resolve('tmp', 'legacy-output')
      const legacyFile = join(legacyOutputDirectory, 'legacy.png')
      const response = await handleLocalAssetRequestFromSettings(toLocalAssetUrl(legacyFile), {
        settings: {
          get(key: string) {
            return (
              ({ 'output.directory': legacyOutputDirectory } as Record<string, string | undefined>)[
                key
              ] ?? null
            )
          }
        },
        fetchAsset: (filePath) => new Response(filePath, { status: 200 }),
        resolverDeps: {
          realpathSync: (filePath: string) => filePath,
          platform: process.platform,
          isTrackedAssetPath: () => false
        }
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(legacyFile)
    })
  })
})
