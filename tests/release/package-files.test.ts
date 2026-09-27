import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Configuration } from 'electron-builder'
import type { FileMatcher } from 'app-builder-lib/out/fileMatcher'

const require = createRequire(import.meta.url)
// This installed builder export exists at runtime but is omitted from its declaration file.
interface MatcherPackager {
  info: {
    config: Configuration
    projectDir: string
    buildResourcesDir: string
    isPrepackedAppAsar: boolean
    debugLogger: { isEnabled: boolean }
  }
}
const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher') as {
  getMainFileMatchers(
    from: string,
    to: string,
    expand: (pattern: string) => string,
    platform: NonNullable<Configuration['win']>,
    packager: MatcherPackager,
    output: string,
    compile: boolean
  ): FileMatcher[]
}
const config = require('js-yaml').load(
  readFileSync(resolve('electron-builder.yml'), 'utf8')
) as Configuration

describe('runtime packaging allowlist', () => {
  it('keeps runtime assets and license while excluding development and local evidence canaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'comfy-package-files-'))
    const runtime = [
      'out/main/index.js',
      'out/preload/index.js',
      'out/renderer/index.html',
      'resources/Danbooru Tag.txt',
      'package.json',
      'LICENSE'
    ]
    const excluded = [
      'tests/secret-canary.txt',
      'scripts/verify.mjs',
      'docs/audit.txt',
      'coverage/index.html',
      '.reports/private-canary.txt',
      '.env',
      'AGENTS.md',
      'src/main/index.ts'
    ]
    try {
      for (const name of [...runtime, ...excluded]) {
        const file = join(root, name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, 'packaging canary')
      }
      const packager = {
        info: {
          config,
          projectDir: root,
          buildResourcesDir: 'build',
          isPrepackedAppAsar: false,
          debugLogger: { isEnabled: false }
        }
      }
      const [matcher] = getMainFileMatchers(
        root,
        join(root, 'dist/app'),
        (value) => value.replace(/\$\{arch\}/g, 'x64'),
        config.win ?? {},
        packager,
        join(root, 'dist'),
        false
      )
      const filter = matcher.createFilter()
      const included = (file: string): boolean =>
        file.split('/').every((_, index, parts) => {
          const current = join(root, ...parts.slice(0, index + 1))
          return filter(current, statSync(current))
        })
      for (const file of runtime) expect(included(file), file).toBe(true)
      for (const file of excluded) expect(included(file), file).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
