// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import TerminalPanel from '@renderer/components/terminal/TerminalPanel.vue'
import { useTerminalStore } from '@renderer/stores/terminal.store'

const invokeIpc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))

describe('terminal panel initialization', () => {
  it('creates one PTY when the panel mounts before the initial request finishes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useTerminalStore()
    let finishCreate!: (id: string) => void
    const pending = new Promise<string>((resolve) => {
      finishCreate = resolve
    })
    invokeIpc.mockImplementation((channel: string) => {
      expect(channel).toBe(IPC_CHANNELS.TERMINAL_CREATE)
      return pending
    })

    store.togglePanel()
    expect(store.panelVisible).toBe(true)
    const wrapper = mount(TerminalPanel, {
      global: { plugins: [pinia], stubs: { TerminalInstance: true } }
    })
    expect(invokeIpc).toHaveBeenCalledTimes(1)
    finishCreate('terminal-1')
    await flushPromises()
    expect(store.tabs).toEqual([{ id: 'terminal-1', title: 'Terminal 1' }])
    expect(store.activeTabId).toBe('terminal-1')
    wrapper.unmount()

    store.hidePanel()
    store.togglePanel()
    const reopened = mount(TerminalPanel, {
      global: { plugins: [pinia], stubs: { TerminalInstance: true } }
    })
    expect(invokeIpc).toHaveBeenCalledTimes(1)
    reopened.unmount()
  })
})
