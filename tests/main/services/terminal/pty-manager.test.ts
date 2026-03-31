import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'path'
import { resolveTerminalWorkingDirectory } from '../../../../src/main/services/terminal/pty-manager'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}))

vi.mock('node-pty', () => ({
  spawn: spawnMock
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../../../../src/main/services/mcp', () => ({
  mcpServerManager: {
    isRunning: false,
    url: 'http://localhost:39464/mcp'
  }
}))

describe('resolveTerminalWorkingDirectory', () => {
  it('prefers HOME when present', () => {
    const fakeHome = resolve('tmp', 'home')
    expect(
      resolveTerminalWorkingDirectory({ HOME: fakeHome, USERPROFILE: resolve('tmp', 'profile') })
    ).toBe(fakeHome)
  })

  it('falls back to USERPROFILE when HOME is missing', () => {
    const fakeProfile = resolve('tmp', 'profile')
    expect(resolveTerminalWorkingDirectory({ USERPROFILE: fakeProfile })).toBe(fakeProfile)
  })

  it('falls back to the provided default home when environment variables are missing', () => {
    const defaultHome = resolve('tmp', 'default-home')
    expect(resolveTerminalWorkingDirectory({}, defaultHome)).toBe(defaultHome)
  })
})

describe('ptyManager', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => ({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn()
    }))
  })

  it('rejects creating terminals beyond the configured limit', async () => {
    const { ptyManager } = await import('../../../../src/main/services/terminal/pty-manager')

    for (let i = 0; i < 10; i++) {
      ptyManager.create(80, 24)
    }

    expect(() => ptyManager.create(80, 24)).toThrow('Maximum terminal limit reached')

    ptyManager.destroyAll()
  })
})
