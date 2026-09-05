import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkEnvironment } from '../../scripts/doctor.mjs'

describe('environment doctor', () => {
  const nodeVersion = readFileSync(resolve('.node-version'), 'utf8').trim()

  it('checks local dependencies without launching the app or installing packages', async () => {
    const probe = vi.fn().mockResolvedValue(undefined)
    const result = await checkEnvironment({ nodeVersion, probe })
    expect(result.status).toBe('passed')
    expect(result.checks.map((check) => check.name)).toEqual([
      'node',
      'dependencies',
      'electron',
      'esbuild'
    ])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('reports version drift and blocked child processes together with actionable remedies', async () => {
    const result = await checkEnvironment({
      nodeVersion: '0.0.0',
      probe: async () => {
        throw new Error('spawn EPERM')
      }
    })
    expect(result.status).toBe('failed')
    expect(result.checks.filter((check) => check.status === 'failed')).toMatchObject([
      { name: 'node', detail: expect.stringContaining('0.0.0'), remedy: expect.any(String) },
      { name: 'esbuild', detail: 'spawn EPERM', remedy: expect.stringContaining('permissions') }
    ])
  })
})
