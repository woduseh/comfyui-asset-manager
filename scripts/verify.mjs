/* eslint-disable @typescript-eslint/explicit-function-return-type -- This standalone Node entrypoint is JavaScript. */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function writeReport(reportPath, report, { renameFile = rename, wait = delay } = {}) {
  const temporary = `${reportPath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`)
  const retryDelays = [50, 100, 200, 400, 800, 1000]
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(temporary, reportPath)
      return
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= retryDelays.length) {
        throw new Error(
          `Cannot publish verification report. Do not use latest.json as the current result while incomplete.json exists. Pending report: ${temporary}`,
          { cause: error }
        )
      }
      await wait(retryDelays[attempt])
    }
  }
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true }
  if (args.length === 0) return { coverage: false }
  if (args.length === 1 && args[0] === '--coverage') return { coverage: true }
  throw new Error('Usage: node scripts/verify.mjs [--coverage | --help]')
}

// Invoke the installed JS entrypoints directly: no platform-dependent shell or npm shim.
export function createPlan({ cwd = projectRoot, coverage = false } = {}) {
  const cli = (path, ...args) => ({
    executable: process.execPath,
    args: [join(cwd, 'node_modules', path), ...args]
  })
  return [
    { name: 'lint', commands: [cli('eslint/bin/eslint.js', '--cache', '.')] },
    {
      name: 'typecheck',
      commands: [
        cli('typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false'),
        cli(
          'vue-tsc/bin/vue-tsc.js',
          '--noEmit',
          '-p',
          'tsconfig.web.json',
          '--composite',
          'false'
        ),
        cli(
          'vue-tsc/bin/vue-tsc.js',
          '--noEmit',
          '-p',
          'tsconfig.test.json',
          '--composite',
          'false'
        )
      ]
    },
    {
      name: coverage ? 'test:coverage' : 'test',
      commands: [cli('vitest/vitest.mjs', 'run', ...(coverage ? ['--coverage'] : []))]
    },
    { name: 'build:bundle', commands: [cli('electron-vite/bin/electron-vite.js', 'build')] }
  ]
}

function stopProcessTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.on('error', () => child.kill('SIGKILL'))
    killer.on('close', (code) => {
      if (code !== 0) child.kill('SIGKILL')
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

function runCommand(command, { cwd, signal, logPath, output, errorOutput }) {
  return new Promise((resolveResult) => {
    if (signal?.aborted) return resolveResult({ exitCode: 130, signal: 'aborted' })
    const child = spawn(command.executable, command.args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const abort = () => stopProcessTree(child)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    let spawnError
    child.stdout.on('data', (chunk) => {
      appendFileSync(logPath, chunk)
      output.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      appendFileSync(logPath, chunk)
      errorOutput.write(chunk)
    })
    child.on('error', (error) => {
      spawnError = error.message
      appendFileSync(logPath, `${error.message}\n`)
      errorOutput.write(`${error.message}\n`)
    })
    child.on('close', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort)
      resolveResult({
        exitCode: code ?? 1,
        signal: exitSignal,
        ...(spawnError && { error: spawnError })
      })
    })
  })
}

export async function runVerification({
  cwd = projectRoot,
  coverage = false,
  plan = createPlan({ cwd, coverage }),
  reportDir = join(cwd, '.reports', 'verify'),
  reportWriter = writeReport,
  signal,
  output = process.stdout,
  errorOutput = process.stderr
} = {}) {
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, 'latest.json')
  const incompletePath = join(reportDir, 'incomplete.json')
  const started = Date.now()
  const report = {
    schemaVersion: 1,
    startedAt: new Date(started).toISOString(),
    cwd,
    coverage,
    status: 'running',
    exitCode: null,
    steps: plan.map((step, index) => ({
      name: step.name,
      status: 'pending',
      exitCode: null,
      durationMs: 0,
      logPath: join(reportDir, `${index + 1}-${step.name.replace(/[^a-z0-9-]/gi, '-')}.log`),
      commands: step.commands
    }))
  }
  const save = () => reportWriter(reportPath, report)
  // A locked previous report must never be mistaken for this run's success.
  writeFileSync(
    incompletePath,
    `${JSON.stringify({ startedAt: report.startedAt, pid: process.pid })}\n`
  )
  // Replace prior success before any command starts, including on an interrupted run.
  await save()
  for (const step of report.steps) writeFileSync(step.logPath, '')
  for (const step of report.steps) {
    if (signal?.aborted) {
      step.status = 'skipped'
      continue
    }
    output.write(`\n=== ${step.name} ===\n`)
    const stepStarted = Date.now()
    step.status = 'running'
    await save()
    step.results = []
    for (const command of step.commands) {
      if (signal?.aborted) break
      step.results.push(
        await runCommand(command, { cwd, signal, logPath: step.logPath, output, errorOutput })
      )
    }
    step.durationMs = Date.now() - stepStarted
    step.exitCode = signal?.aborted
      ? 130
      : (step.results.find((result) => result.exitCode !== 0)?.exitCode ?? 0)
    step.status = signal?.aborted ? 'interrupted' : step.exitCode === 0 ? 'passed' : 'failed'
    await save()
  }
  report.durationMs = Date.now() - started
  report.finishedAt = new Date().toISOString()
  report.status = signal?.aborted
    ? 'interrupted'
    : report.steps.every((step) => step.status === 'passed')
      ? 'passed'
      : 'failed'
  report.exitCode = signal?.aborted ? 130 : report.status === 'passed' ? 0 : 1
  await save()
  unlinkSync(incompletePath)
  output.write('\n=== Verification summary ===\n')
  for (const step of report.steps) {
    output.write(
      `${step.status.padEnd(11)} ${step.name.padEnd(16)} ${(step.durationMs / 1000).toFixed(2)}s  exit=${step.exitCode ?? '-'}\n`
    )
  }
  output.write(
    `Overall: ${report.status} (${(report.durationMs / 1000).toFixed(2)}s)\nReport: ${reportPath}\n`
  )
  return report
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/verify.mjs [--coverage | --help]\nRuns lint, all typechecks, tests, and bundle build; writes .reports/verify/latest.json and step logs.\n'
    )
    return
  }
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  try {
    const report = await runVerification({ ...options, signal: controller.signal })
    process.exitCode = report.exitCode
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exitCode = 1
  })
}
