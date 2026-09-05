/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Real tooling contract checks that can run even when Vite/esbuild cannot start.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { runVerification } from './verify.mjs'
import { assertPhaseEvidence, fingerprintInputs, removeRuntime, runSmoke } from './smoke.mjs'
import { FakeComfyUIServer } from '../tests/helpers/fake-comfyui.ts'

const args = process.argv.slice(2)
assert(
  args.length === 0 || (args.length === 1 && args[0] === '--inject-failure'),
  'Usage: npm run verify:tooling -- [--inject-failure]'
)
const base = resolve(dirname(fileURLToPath(import.meta.url)), '../.reports/tooling')
mkdirSync(base, { recursive: true })
const runDir = mkdtempSync(join(base, 'run-'))
const root = join(runDir, 'runtime')
mkdirSync(root)
const reportPath = join(runDir, 'result.json')
const started = Date.now()
const results = []
const summary = {
  scope: 'tooling contracts; no app UI, product tests, build, or GPU',
  status: 'running',
  startedAt: new Date(started).toISOString(),
  exitCode: null,
  results
}
writeFileSync(reportPath, JSON.stringify(summary, null, 2))
console.log(`Tooling evidence: ${reportPath}`)
let exitCode = 0
const command = (source) => ({ executable: process.execPath, args: ['-e', source] })
try {
  let consoleOutput = ''
  const report = await runVerification({
    cwd: root,
    reportDir: join(runDir, 'verification'),
    output: {
      write(chunk) {
        consoleOutput += chunk.toString()
      }
    },
    plan: [
      { name: 'sync-spawn-failure', commands: [{ executable: '', args: [] }] },
      {
        name: 'real-child-failure',
        commands: [command('console.error("intentional failure"); process.exitCode = 7')]
      },
      {
        name: 'append-and-continue',
        commands: [command('console.log("first check")'), command('console.log("second check")')]
      }
    ]
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.exitCode, 1)
  assert.deepEqual(
    report.steps.map((step) => step.status),
    ['failed', 'failed', 'passed']
  )
  assert.equal(report.steps[1].exitCode, 7)
  assert(report.finishedAt)
  assert(!existsSync(join(runDir, 'verification/incomplete.json')))
  assert.match(consoleOutput, /first check/)
  assert.match(consoleOutput, /second check/)
  assert.match(consoleOutput, /intentional failure/)
  assert.match(readFileSync(report.steps[2].logPath, 'utf8'), /first check\nsecond check/)
  results.push({
    check: 'real failure + later success + append + console + finished report',
    status: 'passed'
  })

  const controller = new AbortController()
  const cancelled = await runVerification({
    cwd: root,
    reportDir: join(runDir, 'cancellation'),
    signal: controller.signal,
    output: {
      write(chunk) {
        if (chunk.toString().includes('cancel-ready:')) controller.abort()
      }
    },
    plan: [
      {
        name: 'cancel',
        commands: [
          command(
            'console.log("cancel-ready:" + process.pid); setTimeout(() => process.exit(29), 4000)'
          )
        ]
      },
      { name: 'not-executed', commands: [command('console.log("must not execute")')] }
    ]
  })
  assert.equal(cancelled.exitCode, 130)
  assert.equal(cancelled.status, 'interrupted')
  assert.equal(cancelled.steps[1].status, 'skipped')
  const cancelLog = readFileSync(cancelled.steps[0].logPath, 'utf8')
  const childPid = Number(cancelLog.match(/cancel-ready:(\d+)/)[1])
  let exited = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(childPid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') {
        exited = true
        break
      }
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert(exited, 'Owned fixture child still running')
  results.push({
    check: 'cancellation from live output preserves interrupted report and skips later checks',
    status: 'passed',
    processTree: cancelled.steps[0].results[0].terminationFailed
      ? 'permission-denied'
      : 'terminated',
    directChildExited: exited
  })

  const smoke = await runSmoke({
    root,
    output: {
      write() {
        return true
      }
    }
  })
  assert.equal(smoke.status, 'failed')
  assert.equal(smoke.steps[0].name, 'environment')
  assert.equal(smoke.steps[0].status, 'failed')
  assert.equal(smoke.cleanup, 'passed')
  assert(!existsSync(join(smoke.runDir, 'runtime')))
  writeFileSync(join(runDir, 'smoke-environment-failure.json'), JSON.stringify(smoke, null, 2))
  results.push({
    check: 'missing environment never passes smoke; runtime removed',
    status: 'passed'
  })
  assert.throws(() =>
    assertPhaseEvidence(
      {
        phase: 'create',
        status: 'passed',
        steps: [],
        errors: [],
        quitObserved: true
      },
      'create'
    )
  )
  results.push({ check: 'empty app checks cannot be reported as passed', status: 'passed' })

  for (const file of [
    'package.json',
    'package-lock.json',
    '.node-version',
    'electron.vite.config.ts'
  ])
    writeFileSync(join(root, file), '{}')
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'resources'))
  writeFileSync(join(root, 'src/input.ts'), 'export const value = 1')
  const before = fingerprintInputs(root)
  writeFileSync(join(root, 'src/input.ts'), 'export const value = 2')
  assert.notEqual(fingerprintInputs(root), before)
  results.push({ check: 'input fingerprint detects changed source', status: 'passed' })

  const fixtures = await Promise.all([FakeComfyUIServer.start(), FakeComfyUIServer.start()])
  const ports = fixtures.map((fixture) => fixture.port)
  try {
    assert.notEqual(ports[0], ports[1])
    for (const port of ports) {
      const response = await fetch(`http://127.0.0.1:${port}/system_stats`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { system: {}, devices: [] })
    }
  } finally {
    await Promise.all(fixtures.map((fixture) => fixture.close()))
  }
  for (const port of ports) {
    const server = createServer()
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
  results.push({
    check: 'two real loopback fixtures use distinct ports and release them',
    status: 'passed',
    ports
  })
  if (args[0] === '--inject-failure') assert.fail('Intentional tooling assertion failure')
} catch (error) {
  exitCode = 1
  results.push({ check: 'assertion', status: 'failed', error: String(error.stack ?? error) })
} finally {
  try {
    removeRuntime(runDir, root)
  } catch (error) {
    exitCode = 1
    summary.cleanupError = String(error)
  }
  Object.assign(summary, {
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    cleanup: !existsSync(root)
  })
  writeFileSync(reportPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = exitCode
}
