import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { resolveLocalAssetPath } from '../../../../src/main/services/assets/local-asset'

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
})
