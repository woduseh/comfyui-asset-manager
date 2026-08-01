import { describe, expect, it } from 'vitest'
import { verifyReleaseMetadata } from '../../scripts/verify-release.mjs'

function makeMetadata(version = '1.0.1'): {
  tag: string
  packageJson: { version: string }
  packageLock: { version: string; packages: { '': { version: string } } }
  changelog: string
} {
  return {
    tag: `v${version}`,
    packageJson: { version },
    packageLock: { version, packages: { '': { version } } },
    changelog: `# Changelog\n\n## [${version}] - 2026-07-29\n\n### Fixed\n\n- Test\n`
  }
}

describe('verifyReleaseMetadata', () => {
  it('accepts synchronized strict semver release metadata', () => {
    expect(verifyReleaseMetadata(makeMetadata())).toBe('1.0.1')
  })

  it('rejects malformed tags and package version drift', () => {
    expect(() => verifyReleaseMetadata({ ...makeMetadata(), tag: 'release-1.0.1' })).toThrow(
      'vMAJOR.MINOR.PATCH'
    )
    expect(() =>
      verifyReleaseMetadata({
        ...makeMetadata(),
        packageJson: { version: '1.0.0' }
      })
    ).toThrow('package.json')
  })

  it('rejects lockfile and changelog drift', () => {
    expect(() =>
      verifyReleaseMetadata({
        ...makeMetadata(),
        packageLock: { version: '1.0.0', packages: { '': { version: '1.0.0' } } }
      })
    ).toThrow('package-lock.json')
    expect(() =>
      verifyReleaseMetadata({
        ...makeMetadata(),
        changelog: '# Changelog\n'
      })
    ).toThrow('CHANGELOG.md')
  })
})
