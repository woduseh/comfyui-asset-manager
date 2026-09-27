/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function probeViteTransform(requireFromProject) {
  const vite = await import(pathToFileURL(requireFromProject.resolve('vite')).href)
  const result = await vite.transformWithOxc('const ready: boolean = true', 'doctor.ts')
  if (!result.code.includes('const ready = true')) {
    throw new Error('Vite did not transform TypeScript as expected')
  }
}

export async function checkEnvironment({
  root = projectRoot,
  nodeVersion = process.versions.node,
  probe = probeViteTransform
} = {}) {
  const checks = []
  const requireFromProject = createRequire(resolve(root, 'package.json'))
  const check = async (name, action, remedy) => {
    try {
      const detail = await action()
      checks.push({ name, status: 'passed', detail })
    } catch (error) {
      checks.push({ name, status: 'failed', detail: String(error.message ?? error), remedy })
    }
  }

  await check(
    'node',
    () => {
      const expected = readFileSync(resolve(root, '.node-version'), 'utf8').trim()
      if (nodeVersion !== expected) throw new Error(`Expected ${expected}, found ${nodeVersion}`)
      return nodeVersion
    },
    'Use the Node.js version in .node-version, then reopen your terminal.'
  )
  await check(
    'dependencies',
    () => {
      for (const name of ['vitest', 'vue-tsc', 'eslint', 'vite-plugin-electron']) {
        requireFromProject.resolve(name)
      }
      const wasm = requireFromProject.resolve('sql.js/dist/sql-wasm.wasm')
      if (!existsSync(wasm)) throw new Error('sql.js WASM file is missing')
      return 'Local verification tools and sql.js WASM are available'
    },
    'Run npm ci from the repository root.'
  )
  await check(
    'electron',
    () => {
      const executable = requireFromProject('electron')
      if (typeof executable !== 'string' || !existsSync(executable)) {
        throw new Error('Electron executable is missing')
      }
      return 'Electron executable is installed (GUI and native PTY not exercised)'
    },
    'Run npm ci with install scripts enabled; check Electron download errors.'
  )
  await check(
    'vite-transform',
    async () => {
      await probe(requireFromProject)
      return 'Vite Oxc transform can compile TypeScript'
    },
    'Run npm ci and verify the Vite/Oxc native package for this platform.'
  )

  return { status: checks.every((item) => item.status === 'passed') ? 'passed' : 'failed', checks }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: npm run doctor -- [--json]\nRead-only local checks; no installation or app launch.'
    )
    return
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
    console.error('Usage: npm run doctor -- [--json]')
    process.exitCode = 2
    return
  }
  const result = await checkEnvironment()
  if (args[0] === '--json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    for (const check of result.checks) {
      console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`)
      if (check.remedy) console.log(`  ${check.remedy}`)
    }
  }
  process.exitCode = result.status === 'passed' ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
