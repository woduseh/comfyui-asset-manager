import { describe, expect, it } from 'vitest'
import { isAbsolute, join, resolve } from 'path'
import {
  getDefaultOutputRoot,
  resolveConfiguredOutputRoot
} from '../../../src/main/services/output-root'

describe('getDefaultOutputRoot', () => {
  it('returns an absolute path under the user home directory', () => {
    const fakeHome = resolve('tmp', 'fake-home')
    const root = getDefaultOutputRoot(fakeHome)
    expect(root).toBe(join(fakeHome, 'Pictures', 'ComfyUI_Output'))
  })
})

describe('resolveConfiguredOutputRoot', () => {
  it('uses the cross-platform default root when no setting is present', () => {
    const fakeHome = resolve('tmp', 'fake-home')
    const resolved = resolveConfiguredOutputRoot(
      {
        get() {
          return null
        }
      },
      undefined,
      fakeHome
    )

    expect(isAbsolute(resolved)).toBe(true)
    expect(resolved).toBe(join(fakeHome, 'Pictures', 'ComfyUI_Output'))
  })
})
