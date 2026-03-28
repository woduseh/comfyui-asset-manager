import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectionStore } from '../../src/renderer/src/stores/connection.store'

describe('connection.store', () => {
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

  it('captures connection failures as observable state', async () => {
    invoke.mockRejectedValue(new Error('connect failed'))
    const store = useConnectionStore()

    await expect(store.connect('localhost', 8188)).resolves.toBe(false)

    expect(store.connectionState).toBe('disconnected')
    expect(store.lastError).toBe('connect failed')
  })
})
