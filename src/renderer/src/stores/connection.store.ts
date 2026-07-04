import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ComfyUIStatus } from '@renderer/types/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { invokeIpc } from '@renderer/utils/ipc'

export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ComfyUIStatus>({
    connected: false,
    host: 'localhost',
    port: 8188
  })
  const lastError = ref<string | null>(null)

  const connectionState = ref<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>(
    'disconnected'
  )

  const isConnected = computed(() => status.value.connected)
  const isConnecting = computed(() => connectionState.value === 'connecting')

  async function connect(host?: string, port?: number): Promise<boolean> {
    connectionState.value = 'connecting'
    lastError.value = null
    try {
      const h = host || status.value.host
      const p = port || status.value.port
      const result = await invokeIpc(IPC_CHANNELS.COMFYUI_CONNECT, {
        host: h,
        port: p
      })
      if (result) {
        status.value.connected = true
        status.value.host = h
        status.value.port = p
        connectionState.value = 'connected'
        return true
      }
      connectionState.value = 'disconnected'
      lastError.value = 'Unable to reach ComfyUI server'
      return false
    } catch (error) {
      connectionState.value = 'disconnected'
      lastError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  async function disconnect(): Promise<void> {
    await invokeIpc(IPC_CHANNELS.COMFYUI_DISCONNECT)
    status.value.connected = false
    connectionState.value = 'disconnected'
  }

  async function fetchSystemStats(): Promise<void> {
    try {
      const stats = await invokeIpc(IPC_CHANNELS.COMFYUI_SYSTEM_STATS)
      if (stats) {
        status.value.systemStats = stats
      }
    } catch (error) {
      void error
      // System stats are opportunistic; keep the last known values on transient failures.
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
    lastError,
    connect,
    disconnect,
    fetchSystemStats,
    setConnectionChanged
  }
})
