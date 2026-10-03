import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectionStore } from '../../src/renderer/src/stores/connection.store'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels'

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
    invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC_CHANNELS.SETTINGS_GET_ALL) {
        return { comfyui_host: '192.168.0.12', comfyui_port: '8288' }
      }
      if (channel === IPC_CHANNELS.COMFYUI_CONNECT) return true
      throw new Error(`Unexpected IPC call: ${channel}`)
    })
    const store = useConnectionStore()

    await expect(store.connectConfigured()).resolves.toBe(true)

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.COMFYUI_CONNECT, {
      host: '192.168.0.12',
      port: 8288
    })
    expect(store.isConnected).toBe(true)
  })

  it.each(['unreachable', 'server change rejected', 'settings unavailable'] as const)(
    'preserves the established connection when %s',
    async (failure) => {
      const store = useConnectionStore()
      invoke.mockResolvedValueOnce(true)
      await store.connect('original-server', 8188)
      if (failure === 'unreachable') invoke.mockResolvedValueOnce(false)
      else invoke.mockRejectedValueOnce(new Error(failure))

      const result =
        failure === 'settings unavailable'
          ? await store.connectConfigured()
          : await store.connect('other-server', 8288)

      expect(result).toBe(false)
      expect(store.lastError).toBeTruthy()
      expect(store.status).toMatchObject({ connected: true, host: 'original-server', port: 8188 })
      expect(store.isConnected).toBe(true)
      expect(store.connectionState).toBe('connected')
    }
  )

  it('exposes settings lookup failures without rejecting the UI event', async () => {
    invoke.mockRejectedValueOnce(new Error('Settings unavailable'))
    const store = useConnectionStore()

    await expect(store.connectConfigured()).resolves.toBe(false)

    expect(store.connectionState).toBe('disconnected')
    expect(store.lastError).toBe('Settings unavailable')
  })
})
