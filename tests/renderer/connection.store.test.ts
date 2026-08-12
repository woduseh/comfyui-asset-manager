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

  it('captures unreachable responses as observable state', async () => {
    invoke.mockResolvedValue(false)
    const store = useConnectionStore()

    await expect(store.connect('localhost', 8188)).resolves.toBe(false)

    expect(store.connectionState).toBe('disconnected')
    expect(store.lastError).toBe('Unable to reach ComfyUI server')
  })

  it('connects with the configured host and port', async () => {
    invoke
      .mockResolvedValueOnce({ comfyui_host: '192.168.0.12', comfyui_port: '8288' })
      .mockResolvedValueOnce(true)
    const store = useConnectionStore()

    await expect(store.connectConfigured()).resolves.toBe(true)

    expect(invoke).toHaveBeenNthCalledWith(2, 'comfyui:connect', {
      host: '192.168.0.12',
      port: 8288
    })
    expect(store.isConnected).toBe(true)
  })

  it('exposes settings lookup failures without rejecting the UI event', async () => {
    invoke.mockRejectedValueOnce(new Error('Settings unavailable'))
    const store = useConnectionStore()

    await expect(store.connectConfigured()).resolves.toBe(false)

    expect(store.connectionState).toBe('disconnected')
    expect(store.lastError).toBe('Settings unavailable')
  })
})
