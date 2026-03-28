import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface AppSettings {
  comfyui_host: string
  comfyui_port: string
  output_directory: string
  language: string
  theme: string
  output_pattern: string
  filename_pattern: string
  max_retries: string
  auto_save_interval: string
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
  auto_save_interval: '5000',
  mcp_enabled: 'false',
  mcp_port: '39464'
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...defaultSettings })
  const loaded = ref(false)
  const loadError = ref<string | null>(null)

  async function loadSettings(): Promise<void> {
    loadError.value = null
    try {
      const all = await window.electron.ipcRenderer.invoke('settings:getAll')
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
      await window.electron.ipcRenderer.invoke('settings:set', { key, value })
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
    return await window.electron.ipcRenderer.invoke('settings:get', { key })
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
