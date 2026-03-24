import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTerminalStore } from '../../src/renderer/src/stores/terminal.store'

describe('terminal.store', () => {
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

  it('creates the first terminal tab without auto-starting MCP or persisting mcp_enabled', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'terminal:create') {
        return 'terminal-1'
      }

      throw new Error(`Unexpected IPC call: ${channel}`)
    })

    const store = useTerminalStore()
    const terminalId = await store.createTab()

    expect(terminalId).toBe('terminal-1')
    expect(store.tabs).toHaveLength(1)
    expect(store.activeTabId).toBe('terminal-1')
    expect(invoke).toHaveBeenCalledWith('terminal:create', { cols: 80, rows: 24 })
    expect(invoke).not.toHaveBeenCalledWith('mcp:start', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('settings:set', {
      key: 'mcp_enabled',
      value: 'true'
    })
  })
})
