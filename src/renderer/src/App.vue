<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, lightTheme } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import AppLayout from './components/layout/AppLayout.vue'
import { useSettingsStore } from './stores/settings.store'
import { useConnectionStore } from './stores/connection.store'
import { useQueueStore } from './stores/queue.store'

const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()
const { locale } = useI18n()
const theme = ref<GlobalTheme | null>(darkTheme)

onMounted(async () => {
  await settingsStore.loadSettings()
  locale.value = settingsStore.settings.language || 'ko'
  updateTheme(settingsStore.settings.theme)

  // Listen for main→renderer events
  window.electron.ipcRenderer.on('comfyui:connection-changed', (_event: unknown, connected: boolean) => {
    connectionStore.setConnectionChanged(connected)
  })

  window.electron.ipcRenderer.on('queue:progress', (_event: unknown, data: { value: number; max: number }) => {
    queueStore.updateProgress({ value: data.value, max: data.max })
  })

  window.electron.ipcRenderer.on('queue:task-completed', (_event: unknown, data: { jobId: string }) => {
    queueStore.onTaskCompleted(data.jobId)
  })

  window.electron.ipcRenderer.on('queue:task-failed', (_event: unknown, data: { jobId: string }) => {
    queueStore.onTaskFailed(data.jobId)
  })

  window.electron.ipcRenderer.on('queue:job-completed', (_event: unknown, data: { jobId: string }) => {
    queueStore.onJobCompleted(data.jobId)
  })

  // Auto-connect on startup if previously connected
  const host = settingsStore.settings.comfyui_host || 'localhost'
  const port = parseInt(settingsStore.settings.comfyui_port) || 8188
  connectionStore.connect(host, port).catch(() => {})
})

watch(
  () => settingsStore.settings.theme,
  (val) => updateTheme(val)
)

function updateTheme(value: string): void {
  theme.value = value === 'light' ? lightTheme : darkTheme
}
</script>

<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <NDialogProvider>
        <AppLayout />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
