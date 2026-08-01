import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

const SEMVER_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function verifyReleaseMetadata({ tag, packageJson, packageLock, changelog }) {
  const match = SEMVER_TAG_PATTERN.exec(tag)
  if (!match) {
    throw new Error(`Release tag must use vMAJOR.MINOR.PATCH format: ${tag}`)
  }

  const version = match.slice(1).join('.')
  if (packageJson.version !== version) {
    throw new Error(`Tag ${tag} does not match package.json version ${packageJson.version}`)
  }
  if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
    throw new Error(`Tag ${tag} does not match package-lock.json root version`)
  }

  const escapedVersion = version.replaceAll('.', '\\.')
  const changelogHeading = new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`, 'm')
  if (!changelogHeading.test(changelog)) {
    throw new Error(`CHANGELOG.md is missing a dated ${version} release section`)
  }

  return version
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function runCli() {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME
  if (!tag) {
    throw new Error('Release tag argument or GITHUB_REF_NAME is required')
  }

  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
  const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf-8'))
  const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf-8')
  const version = verifyReleaseMetadata({ tag, packageJson, packageLock, changelog })
  process.stdout.write(`Release metadata verified for v${version}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
