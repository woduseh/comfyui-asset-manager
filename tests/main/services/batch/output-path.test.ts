import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  resolveSafeOutputDirectory,
  resolveSafeOutputFile
} from '../../../../src/main/services/batch/output-path'

describe.each([
  ['Windows', path.win32, 'C:\\output', 'job\\character', 'C:\\output\\job\\character'],
  ['POSIX', path.posix, '/output', 'job/character', '/output/job/character']
] as const)('safe output paths on %s', (_name, pathOps, root, relativeDir, expectedDir) => {
  it('resolves directories and files inside the configured root', () => {
    const directory = resolveSafeOutputDirectory(root, relativeDir, pathOps)

    expect(directory).toBe(expectedDir)
    expect(resolveSafeOutputFile(root, directory, 'image.png', pathOps)).toBe(
      pathOps.join(expectedDir, 'image.png')
    )
  })

  it('rejects parent traversal outside the configured root', () => {
    expect(() => resolveSafeOutputDirectory(root, '..' + pathOps.sep + 'escape', pathOps)).toThrow(
      'outside the configured output directory'
    )
  })

  it('rejects filename patterns containing directories', () => {
    const directory = resolveSafeOutputDirectory(root, relativeDir, pathOps)

    expect(() => resolveSafeOutputFile(root, directory, '../image.png', pathOps)).toThrow(
      'without directories'
    )
    expect(() => resolveSafeOutputFile(root, directory, '..\\image.png', pathOps)).toThrow(
      'without directories'
    )
  })
})
