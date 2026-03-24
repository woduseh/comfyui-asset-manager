import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../../src/renderer/src/stores/settings.store'

describe('settings.store', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    invoke.mockReset()

    Object.defineProperty(globalThis, 'window', {
      value: {
        electron: {
          ipcRenderer: {
            invoke
          }
        }
      },
      configurable: true
    })
  })

  it('persists setting changes on success', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useSettingsStore()

    await store.setSetting('mcp_enabled', 'true')

    expect(store.settings.mcp_enabled).toBe('true')
    expect(invoke).toHaveBeenCalledWith('settings:set', { key: 'mcp_enabled', value: 'true' })
  })

  it('rolls back local state when persistence fails', async () => {
    invoke.mockRejectedValue(new Error('settings unavailable'))
    const store = useSettingsStore()
    store.settings.mcp_enabled = 'true'

    await expect(store.setSetting('mcp_enabled', 'false')).rejects.toThrow('settings unavailable')
    expect(store.settings.mcp_enabled).toBe('true')
  })
})
