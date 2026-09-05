import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createPlan, parseArguments, runVerification, writeReport } from '../../scripts/verify.mjs'

const directories: string[] = []
const silent = { write: () => true }
const command = (source: string): { executable: string; args: string[] } => ({
  executable: process.execPath,
  args: ['-e', source]
})
function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'verify with spaces-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('verification runner', () => {
  it('recovers from transient Windows report locks without losing the report', async () => {
    const cwd = workspace()
    const reportPath = join(cwd, 'latest.json')
    const waits: number[] = []
    let attempts = 0
    await writeReport(
      reportPath,
      { status: 'passed' },
      {
        renameFile: async (from: string, to: string) => {
          if (attempts++ < 2) throw Object.assign(new Error('locked'), { code: 'EPERM' })
          await rename(from, to)
        },
        wait: async (milliseconds: number) => {
          waits.push(milliseconds)
        }
      }
    )
    expect(attempts).toBe(3)
    expect(waits).toEqual([50, 100])
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ status: 'passed' })
    expect(existsSync(`${reportPath}.${process.pid}.tmp`)).toBe(false)
  })

  it('leaves an incomplete marker when bounded retries cannot replace a previous success', async () => {
    const cwd = workspace()
    const options = {
      cwd,
      output: silent,
      errorOutput: silent,
      plan: [{ name: 'check', commands: [command('')] }]
    }
    const previous = await runVerification(options)
    const reportPath = join(cwd, '.reports/verify/latest.json')
    expect(existsSync(join(cwd, '.reports/verify/incomplete.json'))).toBe(false)
    let attempts = 0
    await expect(
      runVerification({
        ...options,
        reportWriter: (path: string, report: unknown) =>
          writeReport(path, report, {
            renameFile: async () => {
              attempts++
              throw Object.assign(new Error('locked'), { code: 'EACCES' })
            },
            wait: async () => {}
          })
      })
    ).rejects.toThrow('Do not use latest.json as the current result')
    expect(attempts).toBe(7)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(previous)
    expect(existsSync(join(cwd, '.reports/verify/incomplete.json'))).toBe(true)
    expect(JSON.parse(readFileSync(`${reportPath}.${process.pid}.tmp`, 'utf8')).status).toBe(
      'running'
    )
  })

  it('keeps direct CLI commands synchronized with the public npm scripts', () => {
    const cwd = resolve('.')
    const { scripts } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const binaries = new Map([
      [join(cwd, 'node_modules/eslint/bin/eslint.js'), 'eslint'],
      [join(cwd, 'node_modules/typescript/bin/tsc'), 'tsc'],
      [join(cwd, 'node_modules/vue-tsc/bin/vue-tsc.js'), 'vue-tsc'],
      [join(cwd, 'node_modules/vitest/vitest.mjs'), 'vitest'],
      [join(cwd, 'node_modules/electron-vite/bin/electron-vite.js'), 'electron-vite']
    ])
    for (const coverage of [false, true]) {
      for (const step of createPlan({ cwd, coverage })) {
        const scriptNames =
          step.name === 'typecheck'
            ? scripts.typecheck
                .split(' && ')
                .map((script: string) => script.replace(/^npm run /, ''))
            : [step.name]
        expect(step.commands).toHaveLength(scriptNames.length)
        for (const [index, cli] of step.commands.entries()) {
          expect(cli.executable).toBe(process.execPath)
          const binary = binaries.get(cli.args[0])
          expect(binary).toBeDefined()
          expect([binary, ...cli.args.slice(1)].join(' ')).toBe(scripts[scriptNames[index]])
        }
      }
    }
  })

  it('continues after failures, captures both streams, and returns a failing report', async () => {
    const cwd = workspace()
    const report = await runVerification({
      cwd,
      output: silent,
      errorOutput: silent,
      plan: [
        {
          name: 'typecheck',
          commands: [
            command('console.log("first"); console.error("diagnostic"); process.exitCode = 7'),
            command('console.log("second typecheck")')
          ]
        },
        { name: 'build', commands: [command('console.log("build still ran")')] }
      ]
    })
    expect(report.exitCode).toBe(1)
    expect(report.status).toBe('failed')
    expect(report.steps.map((step: { status: string }) => step.status)).toEqual([
      'failed',
      'passed'
    ])
    expect(report.steps[0].exitCode).toBe(7)
    const log = readFileSync(report.steps[0].logPath, 'utf8')
    expect(log).toContain('first')
    expect(log).toContain('diagnostic')
    expect(log).toContain('second typecheck')
    expect(readFileSync(report.steps[1].logPath, 'utf8')).toContain('build still ran')
    expect(JSON.parse(readFileSync(join(cwd, '.reports/verify/latest.json'), 'utf8'))).toEqual(
      report
    )
  })

  it('replaces prior success before executing a new run and truncates reused logs', async () => {
    const cwd = workspace()
    const options = { cwd, output: silent, errorOutput: silent }
    await runVerification({
      ...options,
      plan: [{ name: 'check', commands: [command('console.log("stale log")')] }]
    })
    const report = await runVerification({
      ...options,
      plan: [
        {
          name: 'check',
          commands: [
            command(
              'const fs = require("node:fs"); const report = JSON.parse(fs.readFileSync(".reports/verify/latest.json", "utf8")); console.log(report.status); process.exitCode = report.status === "running" ? 4 : 9'
            )
          ]
        }
      ]
    })
    expect(report.steps[0].exitCode).toBe(4)
    expect(readFileSync(report.steps[0].logPath, 'utf8')).toBe('running\n')
  })

  it('records spawn errors and still executes remaining steps', async () => {
    const cwd = workspace()
    const report = await runVerification({
      cwd,
      output: silent,
      errorOutput: silent,
      plan: [
        { name: 'missing', commands: [{ executable: join(cwd, 'missing-executable'), args: [] }] },
        { name: 'next', commands: [command('')] }
      ]
    })
    expect(report.exitCode).toBe(1)
    expect(report.steps[0].results[0].error).toContain('ENOENT')
    expect(report.steps[1].status).toBe('passed')
  })

  it('records synchronous spawn failures and publishes a finished report after remaining checks', async () => {
    const cwd = workspace()
    const report = await runVerification({
      cwd,
      output: silent,
      errorOutput: silent,
      plan: [
        { name: 'invalid', commands: [{ executable: '', args: [] }] },
        { name: 'next', commands: [command('console.log("remaining check ran")')] }
      ]
    })
    expect(report.exitCode).toBe(1)
    expect(report.status).toBe('failed')
    expect(report.finishedAt).toEqual(expect.any(String))
    expect(report.steps[0]).toMatchObject({ status: 'failed', exitCode: 1 })
    expect(report.steps[0].results[0].error).toContain('cannot be empty')
    expect(readFileSync(report.steps[0].logPath, 'utf8')).toContain('cannot be empty')
    expect(report.steps[1].status).toBe('passed')
    expect(readFileSync(report.steps[1].logPath, 'utf8')).toContain('remaining check ran')
    expect(JSON.parse(readFileSync(join(cwd, '.reports/verify/latest.json'), 'utf8'))).toEqual(
      report
    )
    expect(existsSync(join(cwd, '.reports/verify/incomplete.json'))).toBe(false)
  })

  it('terminates an active child on cancellation and skips remaining checks', async () => {
    const cwd = workspace()
    const controller = new AbortController()
    const report = await runVerification({
      cwd,
      signal: controller.signal,
      output: {
        write: (chunk: string | Buffer) => {
          if (chunk.toString().includes('child-ready')) controller.abort()
          return true
        }
      },
      errorOutput: silent,
      plan: [
        {
          name: 'wait',
          commands: [command('console.log("child-ready"); setInterval(() => {}, 1000)')]
        },
        { name: 'next', commands: [command('console.log("must not run")')] }
      ]
    })
    expect(report.exitCode).toBe(130)
    expect(report.status).toBe('interrupted')
    expect(report.steps[0].status).toBe('interrupted')
    expect(report.steps[1].status).toBe('skipped')
    expect(readFileSync(report.steps[1].logPath, 'utf8')).toBe('')
  })

  it('supports coverage and rejects invalid CLI usage with a nonzero exit', () => {
    expect(parseArguments([])).toEqual({ coverage: false })
    expect(parseArguments(['--coverage'])).toEqual({ coverage: true })
    expect(parseArguments(['--help'])).toEqual({ help: true })
    const plan = createPlan({ cwd: workspace(), coverage: true })
    expect(plan.map((step: { name: string }) => step.name)).toEqual([
      'lint',
      'typecheck',
      'test:coverage',
      'build:bundle'
    ])
    expect(plan[2].commands[0].args).toContain('--coverage')
    const script = resolve('scripts/verify.mjs')
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('Usage:')
    const invalid = spawnSync(process.execPath, [script, '--unknown'], { encoding: 'utf8' })
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('Usage:')
  })
})
