import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { resolveTerminalWorkingDirectory } from '../../../../src/main/services/terminal/pty-manager'

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
