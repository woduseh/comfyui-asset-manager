import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import {
  assertPhaseEvidence,
  parseSmokeArguments,
  removeRuntime,
  runLoggedProcess
} from '../../scripts/smoke.mjs'

const directories: string[] = []

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'smoke tooling with spaces-'))
  directories.push(directory)
  return directory
}

function fixture(
  cwd: string,
  name: string,
  source: string,
  timeoutMs = 5000,
  signal?: AbortSignal
): ReturnType<typeof runLoggedProcess> {
  return runLoggedProcess(process.execPath, ['-e', source], {
    cwd,
    logPath: join(cwd, `${name}.log`),
    timeoutMs,
    signal,
    env: process.env,
    output: undefined
  })
}

function processHasExited(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    throw error
  }
}

function evidence(phase: 'create' | 'reopen'): {
  phase: string
  status: string
  steps: { name: string; status: string }[]
  errors: string[]
  quitObserved: boolean
} {
  const names =
    phase === 'create'
      ? [
          'renderer-preload-security',
          'open-library',
          'create-module-through-ui',
          'create-item-through-ui',
          'invalid-ipc-rejected-without-write',
          'disconnect-and-reconnect-through-ui'
        ]
      : ['renderer-preload-security', 'open-library', 'persisted-item-after-restart']
  return {
    phase,
    status: 'passed',
    steps: names.map((name) => ({ name, status: 'passed' })),
    errors: [],
    quitObserved: true
  }
}

function bootstrapDriver(
  cwd: string,
  timers: {
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number
    clearTimeout: (timer: ReturnType<typeof setTimeout> | number) => void
  } = { setTimeout: () => 0, clearTimeout: () => {} }
): {
  app: EventEmitter & { quit: () => void }
  config: { profileDir: string; reportPath: string }
  bootstrapPaths: Record<string, string>
} {
  const config = {
    phase: 'create',
    root: resolve('.'),
    runDir: cwd,
    profileDir: join(cwd, 'profile'),
    bundleDir: join(cwd, 'bundle'),
    reportPath: join(cwd, 'create.json'),
    timeoutMs: 45_000
  }
  const configPath = join(cwd, 'config.json')
  writeFileSync(configPath, JSON.stringify(config))
  const paths: Record<string, string> = {}
  const bootstrapPaths: Record<string, string> = {}
  const app = Object.assign(new EventEmitter(), {
    quit: vi.fn(),
    setPath: (name: string, path: string): void => {
      paths[name] = path
    },
    setAppLogsPath: (path: string): void => {
      paths.logs = path
    }
  })
  const require = createRequire(join(config.root, 'package.json'))
  const driverPath = join(config.root, 'scripts/smoke/electron.cjs')
  runInNewContext(
    readFileSync(driverPath, 'utf8'),
    {
      require: (id: string): unknown => {
        if (id === 'electron') return { app }
        if (id === join(config.bundleDir, 'main/index.js')) {
          Object.assign(bootstrapPaths, paths)
          return {}
        }
        return require(id)
      },
      process: { argv: ['electron', driverPath, configPath] },
      ...timers
    },
    { filename: driverPath }
  )
  return { app, config, bootstrapPaths }
}

afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) {
    expect(dirname(realpathSync(directory))).toBe(realpathSync(tmpdir()))
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('smoke subprocess evidence', () => {
  it('preserves real child exit codes and captures stdout and stderr in a file', async () => {
    const cwd = workspace()
    const result = await fixture(
      cwd,
      'failure',
      'console.log("stdout evidence"); console.error("stderr evidence"); process.exitCode = 7'
    )
    expect(result).toMatchObject({ exitCode: 7, timedOut: false })
    const log = readFileSync(join(cwd, 'failure.log'), 'utf8')
    expect(log).toContain('stdout evidence')
    expect(log).toContain('stderr evidence')
  })

  it('does not launch a child when cancellation was already requested', async () => {
    const cwd = workspace()
    const controller = new AbortController()
    const marker = join(cwd, 'unexpected-child.txt')
    controller.abort()
    const result = await fixture(
      cwd,
      'already-canceled',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`,
      1000,
      controller.signal
    )
    expect(result).toMatchObject({ exitCode: 130, signal: 'aborted' })
    expect(existsSync(marker)).toBe(false)
  })

  it('records both synchronous and asynchronous launch failures in the diagnostic log', async () => {
    const cwd = workspace()
    for (const [name, executable, message] of [
      ['invalid', '', 'cannot be empty'],
      ['missing', join(cwd, 'missing-executable'), 'ENOENT']
    ]) {
      const logPath = join(cwd, `${name}.log`)
      const result = await runLoggedProcess(executable, [], {
        cwd,
        logPath,
        timeoutMs: 1000,
        signal: undefined,
        env: process.env,
        output: undefined
      })
      expect(result).not.toMatchObject({ exitCode: 0 })
      expect(result).toMatchObject({ error: expect.stringContaining(message) })
      expect(readFileSync(logPath, 'utf8')).toContain(message)
    }
  })

  it('times out and terminates a real child instead of leaving it running', async () => {
    const cwd = workspace()
    const result = await fixture(
      cwd,
      'timeout',
      'console.log("pid:" + process.pid); setTimeout(() => process.exit(29), 4000)',
      1500
    )
    const pid = Number(readFileSync(join(cwd, 'timeout.log'), 'utf8').match(/pid:(\d+)/)?.[1])
    expect(pid).toBeGreaterThan(0)
    await expect.poll(() => processHasExited(pid), { timeout: 6000 }).toBe(true)
    expect(result).toMatchObject({ exitCode: 1, timedOut: true })
    expect(result).not.toMatchObject({ terminationFailed: true })
  }, 10_000)

  it('reports cancellation separately from a timeout and closes the child', async () => {
    const cwd = workspace()
    const controller = new AbortController()
    const running = fixture(
      cwd,
      'cancel',
      'console.log("pid:" + process.pid); setTimeout(() => process.exit(29), 4000)',
      5000,
      controller.signal
    )
    let result: Awaited<ReturnType<typeof runLoggedProcess>>
    try {
      await expect
        .poll(() => readFileSync(join(cwd, 'cancel.log'), 'utf8'), { timeout: 3000 })
        .toContain('pid:')
    } finally {
      controller.abort()
      result = await running
    }
    const pid = Number(readFileSync(join(cwd, 'cancel.log'), 'utf8').match(/pid:(\d+)/)?.[1])
    expect(pid).toBeGreaterThan(0)
    await expect.poll(() => processHasExited(pid), { timeout: 6000 }).toBe(true)
    expect(result).toMatchObject({ exitCode: 130, timedOut: false })
    expect(result).not.toMatchObject({ terminationFailed: true })
  }, 10_000)

  it('keeps simultaneous child outcomes and log files independent', async () => {
    const cwd = workspace()
    const [first, second] = await Promise.all([
      fixture(
        cwd,
        'first',
        'setTimeout(() => { console.log("first only"); process.exitCode = 3 }, 100)'
      ),
      fixture(cwd, 'second', 'console.log("second only")')
    ])
    expect(first).toMatchObject({ exitCode: 3, timedOut: false })
    expect(second).toMatchObject({ exitCode: 0, timedOut: false })
    expect(readFileSync(join(cwd, 'first.log'), 'utf8')).toBe('first only\n')
    expect(readFileSync(join(cwd, 'second.log'), 'utf8')).toBe('second only\n')
  })
})

describe('smoke phase evidence', () => {
  it.each(['create', 'reopen'] as const)('requires complete %s evidence', (phase) => {
    expect(() => assertPhaseEvidence(evidence(phase), phase)).not.toThrow()
    const partial = evidence(phase)
    partial.steps.pop()
    expect(() => assertPhaseEvidence(partial, phase)).toThrow()
    expect(() => assertPhaseEvidence({ ...evidence(phase), steps: [] }, phase)).toThrow()
    expect(() => assertPhaseEvidence({ ...evidence(phase), steps: undefined }, phase)).toThrow()
  })

  it.each(['pending', 'running', 'skipped', 'failed'])(
    'rejects a %s step despite a passed phase',
    (status) => {
      const result = evidence('create')
      result.steps[0].status = status
      expect(() => assertPhaseEvidence(result, 'create')).toThrow()
    }
  )

  it('rejects wrong phases, missing shutdown evidence, and renderer errors', () => {
    expect(() => assertPhaseEvidence(evidence('create'), 'reopen')).toThrow()
    expect(() =>
      assertPhaseEvidence({ ...evidence('create'), status: 'running' }, 'create')
    ).toThrow()
    expect(() =>
      assertPhaseEvidence({ ...evidence('create'), quitObserved: false }, 'create')
    ).toThrow()
    expect(() =>
      assertPhaseEvidence({ ...evidence('create'), errors: ['preload failed'] }, 'create')
    ).toThrow()
  })
})

describe('Electron smoke bootstrap contracts', () => {
  it('isolates profile, session, and logs before importing the built application', () => {
    const cwd = workspace()
    const { config, bootstrapPaths } = bootstrapDriver(cwd)
    expect(bootstrapPaths).toEqual({
      userData: config.profileDir,
      sessionData: config.profileDir,
      logs: join(cwd, 'app-logs')
    })
    expect(JSON.parse(readFileSync(config.reportPath, 'utf8'))).toMatchObject({
      status: 'running',
      quitObserved: false,
      steps: [],
      errors: []
    })
  })

  it('records errors from the current WebContents console event signature', () => {
    const { app, config } = bootstrapDriver(workspace())
    const webContents = new EventEmitter()
    const window = Object.assign(new EventEmitter(), { webContents })
    app.emit('browser-window-created', {}, window)
    webContents.emit('console-message', { level: 'warning', message: 'warning only' }, 2)
    webContents.emit('console-message', { level: 'error', message: 'renderer diagnostic' }, 3)
    expect(JSON.parse(readFileSync(config.reportPath, 'utf8'))).toMatchObject({
      status: 'running',
      quitObserved: false,
      errors: ['renderer diagnostic']
    })
  })

  it('persists the original failure before a stalled capture and quits after its deadline', async () => {
    vi.useFakeTimers()
    const { app, config } = bootstrapDriver(workspace(), { setTimeout, clearTimeout })
    const webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi
        .fn()
        .mockRejectedValueOnce(new Error('original renderer failure'))
        .mockResolvedValue(undefined),
      capturePage: vi.fn(() => new Promise<never>(() => {}))
    })
    const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false })
    app.emit('browser-window-created', {}, window)
    webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(0)

    expect(JSON.parse(readFileSync(config.reportPath, 'utf8'))).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('original renderer failure')
    })
    expect(webContents.capturePage).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2999)
    expect(app.quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(config.reportPath, 'utf8'))).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('original renderer failure'),
      screenshotError: expect.stringContaining('screenshot timed out')
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a rejected failure capture separate from the original error and clears its timer', async () => {
    vi.useFakeTimers()
    const { app, config } = bootstrapDriver(workspace(), { setTimeout, clearTimeout })
    const webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi
        .fn()
        .mockRejectedValueOnce(new Error('original renderer failure'))
        .mockResolvedValue(undefined),
      capturePage: vi.fn().mockRejectedValue(new Error('capture unavailable'))
    })
    const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false })
    app.emit('browser-window-created', {}, window)
    webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(0)

    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(config.reportPath, 'utf8'))).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('original renderer failure'),
      screenshotError: expect.stringContaining('capture unavailable')
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('smoke cleanup boundary', () => {
  it('removes only runtime while retaining evidence', () => {
    const runDir = workspace()
    const runtimeDir = join(runDir, 'runtime')
    mkdirSync(join(runtimeDir, 'profile'), { recursive: true })
    writeFileSync(join(runtimeDir, 'profile', 'fixture.db'), 'temporary database')
    writeFileSync(join(runDir, 'result.json'), 'evidence')
    removeRuntime(runDir, runtimeDir)
    expect(existsSync(runtimeDir)).toBe(false)
    expect(readFileSync(join(runDir, 'result.json'), 'utf8')).toBe('evidence')
  })

  it('refuses parent, sibling, and nested paths without deleting their files', () => {
    const runDir = workspace()
    for (const target of [runDir, join(runDir, 'other'), join(runDir, 'runtime', 'nested')]) {
      mkdirSync(target, { recursive: true })
      const sentinel = join(target, 'keep.txt')
      writeFileSync(sentinel, 'keep')
      expect(() => removeRuntime(runDir, target)).toThrow('Refusing')
      expect(readFileSync(sentinel, 'utf8')).toBe('keep')
    }
  })

  it('refuses a runtime junction or symlink redirected outside the run directory', () => {
    const cwd = workspace()
    const runDir = join(cwd, 'run')
    const outside = join(cwd, 'outside')
    mkdirSync(runDir)
    mkdirSync(outside)
    const sentinel = join(outside, 'keep.txt')
    writeFileSync(sentinel, 'keep')
    const runtimeDir = join(runDir, 'runtime')
    symlinkSync(outside, runtimeDir, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => removeRuntime(runDir, runtimeDir)).toThrow('Refusing')
    expect(readFileSync(sentinel, 'utf8')).toBe('keep')
  })
})

describe('smoke command options', () => {
  it('keeps existing builds explicitly limited and bounds process deadlines', () => {
    expect(parseSmokeArguments([])).toEqual({
      existingBuild: false,
      injectFailure: false,
      timeoutMs: 45_000
    })
    expect(
      parseSmokeArguments(['--existing-build', '--inject-failure', '--timeout-ms', '1500'])
    ).toEqual({
      existingBuild: true,
      injectFailure: true,
      timeoutMs: 1500
    })
    for (const args of [
      ['--unknown'],
      ['--timeout-ms'],
      ['--timeout-ms', '0'],
      ['--timeout-ms', '120001']
    ]) {
      expect(() => parseSmokeArguments(args)).toThrow('Usage:')
    }
  })
})
