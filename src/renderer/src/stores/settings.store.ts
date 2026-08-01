import { defineStore } from 'pinia'
import { ref } from 'vue'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { invokeIpc } from '@renderer/utils/ipc'

export interface AppSettings {
  comfyui_host: string
  comfyui_port: string
  output_directory: string
  language: string
  theme: string
  output_pattern: string
  filename_pattern: string
  max_retries: string
  [key: string]: string
}

const defaultSettings: AppSettings = {
  comfyui_host: 'localhost',
  comfyui_port: '8188',
  output_directory: '',
  language: 'ko',
  theme: 'dark',
  output_pattern: '{job}/{character}/{outfit}/{emotion}',
  filename_pattern: '{character}_{outfit}_{emotion}_{index}',
  max_retries: '3',
  mcp_enabled: 'false',
  mcp_port: '39464',
  mcp_auth_required: 'true'
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...defaultSettings })
  const loaded = ref(false)
  const loadError = ref<string | null>(null)

  async function loadSettings(): Promise<void> {
    loadError.value = null
    try {
      const all = await invokeIpc(IPC_CHANNELS.SETTINGS_GET_ALL)
      if (all) {
        settings.value = { ...defaultSettings, ...all }
      }
      loaded.value = true
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error)
      loaded.value = true
    }
  }

  async function setSetting(key: string, value: string): Promise<void> {
    const previousValue = settings.value[key]
    settings.value[key] = value
    try {
      await invokeIpc(IPC_CHANNELS.SETTINGS_SET, { key, value })
    } catch (error) {
      if (previousValue === undefined) {
        delete settings.value[key]
      } else {
        settings.value[key] = previousValue
      }
      throw error
    }
  }

  async function getSetting(key: string): Promise<string | null> {
    return await invokeIpc(IPC_CHANNELS.SETTINGS_GET, { key })
  }

  return {
    settings,
    loaded,
    loadError,
    loadSettings,
    setSetting,
    getSetting
  }
})
