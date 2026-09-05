/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runLoggedProcess } from './lib/process.mjs'
export { runLoggedProcess } from './lib/process.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const usage = 'Usage: npm run smoke -- [--existing-build] [--inject-failure] [--timeout-ms 45000]'

export function fingerprintInputs(root) {
  const files = ['package.json', 'package-lock.json', '.node-version', 'electron.vite.config.ts']
  for (const directory of ['src', 'resources']) {
    for (const entry of readdirSync(join(root, directory), {
      recursive: true,
      withFileTypes: true
    })) {
      if (entry.isFile()) files.push(relative(root, join(entry.parentPath, entry.name)))
    }
  }
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash
      .update(file.replaceAll('\\', '/'))
      .update('\0')
      .update(readFileSync(join(root, file)))
      .update('\0')
  }
  return hash.digest('hex')
}

export function parseSmokeArguments(args) {
  const options = { existingBuild: false, injectFailure: false, timeoutMs: 45_000 }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--existing-build') options.existingBuild = true
    else if (args[index] === '--inject-failure') options.injectFailure = true
    else if (args[index] === '--timeout-ms') {
      const value = Number(args[++index])
      if (!Number.isInteger(value) || value < 1000 || value > 120_000) throw new Error(usage)
      options.timeoutMs = value
    } else throw new Error(usage)
  }
  return options
}

export function removeRuntime(runDir, runtimeDir) {
  // Never recursively remove a caller-selected directory or follow a replaced junction.
  const parent = realpathSync(runDir)
  const target = realpathSync(runtimeDir)
  assert.equal(relative(parent, target), 'runtime', 'Refusing to remove an unexpected runtime path')
  assert(!isAbsolute(relative(parent, target)))
  rmSync(target, { recursive: true, maxRetries: 5, retryDelay: 100 })
}

export function assertPhaseEvidence(result, phase) {
  assert.equal(result.phase, phase, 'Wrong Electron phase report')
  assert.equal(result.status, 'passed', result.error ?? 'Electron did not complete its checks')
  const required = [
    'renderer-preload-security',
    'open-library',
    ...(phase === 'create'
      ? [
          'create-module-through-ui',
          'create-item-through-ui',
          'invalid-ipc-rejected-without-write',
          'disconnect-and-reconnect-through-ui'
        ]
      : ['persisted-item-after-restart'])
  ]
  assert(['create', 'reopen'].includes(phase), 'Unknown Electron phase')
  assert.deepEqual(
    result.steps.map((step) => step.name),
    required,
    'Missing or unexpected Electron checks'
  )
  assert(
    result.steps.every((step) => step.status === 'passed'),
    'Incomplete Electron check'
  )
  assert.deepEqual(result.errors, [], 'Unexpected renderer/preload failure')
  assert.equal(result.quitObserved, true, 'Normal Electron shutdown was not observed')
}

export async function runSmoke({
  root = projectRoot,
  existingBuild = false,
  injectFailure = false,
  timeoutMs = 45_000,
  signal,
  output = process.stdout
} = {}) {
  const reportBase = join(root, '.reports', 'smoke')
  mkdirSync(reportBase, { recursive: true })
  const runDir = mkdtempSync(join(reportBase, 'run-'))
  const runtimeDir = join(runDir, 'runtime')
  const bundleDir = join(runtimeDir, 'bundle')
  const profileDir = join(runtimeDir, 'profile')
  const reportPath = join(runDir, 'result.json')
  mkdirSync(profileDir, { recursive: true })
  const started = Date.now()
  const report = {
    schemaVersion: 1,
    status: 'running',
    startedAt: new Date(started).toISOString(),
    root,
    runDir,
    bundleScope: existingBuild ? 'existing-build-only' : 'fresh-build',
    integration: 'Electron + real preload/IPC/sql.js + loopback ComfyUI fixture; no GPU',
    injectFailure,
    exitCode: null,
    steps: [],
    cleanup: 'pending'
  }
  const save = () => writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  save()
  output.write(`Smoke evidence: ${reportPath}\n`)
  const step = async (name, action) => {
    if (signal?.aborted) throw new Error('Smoke interrupted')
    const item = { name, status: 'running', startedAt: new Date().toISOString() }
    report.steps.push(item)
    save()
    output.write(`[RUNNING] ${name}\n`)
    const since = Date.now()
    try {
      await action(item)
      item.status = 'passed'
    } catch (error) {
      item.status = 'failed'
      item.error = String(error.stack ?? error)
      throw error
    } finally {
      item.durationMs = Date.now() - since
      save()
    }
  }
  let fixture
  let SQL
  let electron
  let terminationFailed = false
  const env = { ...process.env, NODE_ENV: 'production' }
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_RENDERER_URL',
    'ELECTRON_CLI_ARGS',
    'REMOTE_DEBUGGING_PORT'
  ])
    delete env[name]
  const execute = async (item, executable, args, limit = timeoutMs) => {
    item.logPath = join(runDir, `${item.name}.log`)
    item.process = await runLoggedProcess(executable, args, {
      cwd: root,
      logPath: item.logPath,
      timeoutMs: limit,
      signal,
      env
    })
    terminationFailed ||= item.process.terminationFailed === true
    assert.equal(
      item.process.exitCode,
      0,
      `${item.name} failed${item.process.timedOut ? ' (timeout)' : ''}; see ${item.logPath}`
    )
  }
  try {
    await step('environment', async (item) => {
      assert.equal(process.versions.node, readFileSync(join(root, '.node-version'), 'utf8').trim())
      const require = createRequire(join(root, 'package.json'))
      electron = require('electron')
      assert.equal(typeof electron, 'string')
      assert(
        existsSync(electron),
        'Electron executable is missing; run npm ci with install scripts'
      )
      SQL = await require('sql.js')()
      item.node = process.versions.node
      item.electron = require('electron/package.json').version
      item.platform = process.platform
      item.arch = process.arch
    })
    await step(existingBuild ? 'copy-existing-build' : 'build', async (item) => {
      if (!existingBuild) report.inputSha256 = fingerprintInputs(root)
      if (existingBuild) cpSync(join(root, 'out'), bundleDir, { recursive: true })
      else
        await execute(
          item,
          process.execPath,
          [
            join(root, 'node_modules/electron-vite/bin/electron-vite.js'),
            'build',
            '--outDir',
            bundleDir
          ],
          120_000
        )
      for (const file of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
        assert(existsSync(join(bundleDir, file)), `Missing application bundle: ${file}`)
      }
      if (!existingBuild)
        assert.equal(
          fingerprintInputs(root),
          report.inputSha256,
          'Source changed during build; rerun smoke'
        )
      // The emitted main bundle references resources relative to its output root.
      cpSync(join(root, 'resources'), join(runtimeDir, 'resources'), { recursive: true })
    })
    await step('fixture', async (item) => {
      const { FakeComfyUIServer } = await import(
        pathToFileURL(join(root, 'tests/helpers/fake-comfyui.ts')).href
      )
      fixture = await FakeComfyUIServer.start()
      item.host = fixture.host
      item.port = fixture.port
      const db = new SQL.Database()
      try {
        db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        for (const [key, value] of Object.entries({
          comfyui_host: fixture.host,
          comfyui_port: String(fixture.port),
          mcp_enabled: 'false',
          language: 'ko',
          output_directory: join(runtimeDir, 'output')
        }))
          db.run('INSERT INTO settings VALUES (?, ?)', [key, value])
        mkdirSync(join(profileDir, 'data'), { recursive: true })
        writeFileSync(join(profileDir, 'data/comfyui_asset_manager.db'), db.export())
      } finally {
        db.close()
      }
    })
    for (const phase of ['create', 'reopen']) {
      await step(phase, async (item) => {
        const configPath = join(runDir, `${phase}-config.json`)
        const phaseReport = join(runDir, `${phase}.json`)
        writeFileSync(
          configPath,
          JSON.stringify({
            phase,
            bundleDir,
            profileDir,
            runDir,
            root,
            reportPath: phaseReport,
            injectFailure,
            timeoutMs: Math.max(500, timeoutMs - 5000)
          })
        )
        await execute(item, electron, [join(root, 'scripts/smoke/electron.cjs'), configPath])
        const result = JSON.parse(readFileSync(phaseReport, 'utf8'))
        assertPhaseEvidence(result, phase)
        item.evidence = phaseReport
        // Inspect the actual disk snapshot after app.quit() has awaited closeDatabase().
        const db = new SQL.Database(readFileSync(join(profileDir, 'data/comfyui_asset_manager.db')))
        try {
          assert.equal(
            db.exec("SELECT count(*) FROM prompt_modules WHERE name = 'Smoke module'")[0]
              ?.values[0][0],
            1
          )
          assert.equal(
            db.exec("SELECT prompt FROM module_items WHERE name = 'Smoke item'")[0]?.values[0][0],
            'smoke prompt'
          )
        } finally {
          db.close()
        }
      })
    }
    assert(
      fixture.requests.some((request) => request.path === '/system_stats'),
      'No real HTTP request reached the fixture'
    )
    assert.equal(fixture.accepted.length, 0, 'This smoke must not submit generation requests')
    report.status = existingBuild ? 'limited' : 'passed'
    report.exitCode = existingBuild ? 2 : 0
  } catch (error) {
    report.status = signal?.aborted ? 'interrupted' : 'failed'
    report.error = String(error.stack ?? error)
    report.exitCode = signal?.aborted ? 130 : 1
  } finally {
    try {
      if (fixture) {
        report.fixtureRequests = fixture.requests.map(({ method, path }) => ({ method, path }))
        await fixture.close()
      }
      assert(!terminationFailed, 'Child termination failed; runtime retained for diagnosis')
      removeRuntime(runDir, runtimeDir)
      report.cleanup = 'passed'
    } catch (error) {
      report.cleanup = 'failed'
      report.cleanupError = String(error)
      report.status = 'failed'
      report.exitCode = 1
    }
    report.finishedAt = new Date().toISOString()
    report.durationMs = Date.now() - started
    save()
    output.write(
      `Smoke: ${report.status}; cleanup=${report.cleanup}; exit=${report.exitCode}; ${(report.durationMs / 1000).toFixed(2)}s\n`
    )
    if (existingBuild)
      output.write(
        'Existing bundle only: current source build was NOT verified (exit 2 on otherwise successful checks).\n'
      )
    output.write(`Report: ${reportPath}\n`)
  }
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  try {
    if (process.argv.slice(2).join(' ') === '--help') process.stdout.write(`${usage}\n`)
    else
      process.exitCode = (
        await runSmoke({ ...parseSmokeArguments(process.argv.slice(2)), signal: controller.signal })
      ).exitCode
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exitCode = 1
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}
