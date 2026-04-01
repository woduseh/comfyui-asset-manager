import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCrashHandlers } from '../../src/main/crash-handler'

describe('installCrashHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs and exits on uncaught exceptions', () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const on = vi.fn((event: string, handler: (value: unknown) => void) => {
      listeners.set(event, handler)
      return process
    })
    const log = { error: vi.fn() }
    const exit = vi.fn()

    installCrashHandlers({ on } as unknown as NodeJS.Process, log, exit)

    const error = new Error('boom')
    listeners.get('uncaughtException')?.(error)

    expect(log.error).toHaveBeenCalledWith('[CRASH] Uncaught exception:', error)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('logs but does not exit on unhandled rejections', () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const on = vi.fn((event: string, handler: (value: unknown) => void) => {
      listeners.set(event, handler)
      return process
    })
    const log = { error: vi.fn() }
    const exit = vi.fn()

    installCrashHandlers({ on } as unknown as NodeJS.Process, log, exit)

    listeners.get('unhandledRejection')?.('nope')

    expect(log.error).toHaveBeenCalledWith('[CRASH] Unhandled promise rejection:', 'nope')
    expect(exit).not.toHaveBeenCalled()
  })

  it('logs non-Error uncaught exceptions without coercion', () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const on = vi.fn((event: string, handler: (value: unknown) => void) => {
      listeners.set(event, handler)
      return process
    })
    const log = { error: vi.fn() }
    const exit = vi.fn()

    installCrashHandlers({ on } as unknown as NodeJS.Process, log, exit)

    const thrownValue = { code: 'E_BROKEN', fatal: true }
    listeners.get('uncaughtException')?.(thrownValue)

    expect(log.error).toHaveBeenCalledWith('[CRASH] Uncaught exception:', thrownValue)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
