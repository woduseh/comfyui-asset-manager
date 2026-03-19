import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ComfyUIStatus } from '@renderer/types/ipc'

export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ComfyUIStatus>({
    connected: false,
    host: 'localhost',
    port: 8188
  })

  const connectionState = ref<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>(
    'disconnected'
  )

  const isConnected = computed(() => status.value.connected)
  const isConnecting = computed(() => connectionState.value === 'connecting')

  async function connect(host?: string, port?: number): Promise<boolean> {
    connectionState.value = 'connecting'
    try {
      const h = host || status.value.host
      const p = port || status.value.port
      const result = await window.electron.ipcRenderer.invoke('comfyui:connect', { host: h, port: p })
      if (result) {
        status.value.connected = true
        status.value.host = h
        status.value.port = p
        connectionState.value = 'connected'
        return true
      }
      connectionState.value = 'disconnected'
      return false
    } catch {
      connectionState.value = 'disconnected'
      return false
    }
  }

  async function disconnect(): Promise<void> {
    await window.electron.ipcRenderer.invoke('comfyui:disconnect')
    status.value.connected = false
    connectionState.value = 'disconnected'
  }

  async function fetchSystemStats(): Promise<void> {
    try {
      const stats = await window.electron.ipcRenderer.invoke('comfyui:system-stats')
      if (stats) {
        status.value.systemStats = stats
      }
    } catch {
      // ignore
    }
  }

  function setConnectionChanged(connected: boolean): void {
    status.value.connected = connected
    connectionState.value = connected ? 'connected' : 'disconnected'
  }

  return {
    status,
    connectionState,
    isConnected,
    isConnecting,
    connect,
    disconnect,
    fetchSystemStats,
    setConnectionChanged
  }
})
