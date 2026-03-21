<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, lightTheme } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import AppLayout from './components/layout/AppLayout.vue'
import { useSettingsStore } from './stores/settings.store'
import { useConnectionStore } from './stores/connection.store'
import { useQueueStore } from './stores/queue.store'
import type { QueueProgress } from './types/ipc'

const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()
const { locale } = useI18n()
const theme = ref<GlobalTheme | null>(darkTheme)

// Named handlers for proper cleanup
const onConnectionChanged = (_event: unknown, connected: boolean): void => {
  connectionStore.setConnectionChanged(connected)
}

const onQueueProgress = (_event: unknown, data: QueueProgress): void => {
  queueStore.updateProgress(data)
}

const onTaskCompleted = (
  _event: unknown,
  data: { jobId: string; etaMs?: number; avgTaskDurationMs?: number }
): void => {
  queueStore.onTaskCompleted(data)
}

const onTaskFailed = (_event: unknown, data: { jobId: string; etaMs?: number }): void => {
  queueStore.onTaskFailed(data)
}

const onJobCompleted = (_event: unknown, data: { jobId: string }): void => {
  queueStore.onJobCompleted(data.jobId)
}

onMounted(async () => {
  await settingsStore.loadSettings()
  locale.value = settingsStore.settings.language || 'ko'
  updateTheme(settingsStore.settings.theme)

  // Listen for main→renderer events
  window.electron.ipcRenderer.on('comfyui:connection-changed', onConnectionChanged)
  window.electron.ipcRenderer.on('queue:progress', onQueueProgress)
  window.electron.ipcRenderer.on('queue:task-completed', onTaskCompleted)
  window.electron.ipcRenderer.on('queue:task-failed', onTaskFailed)
  window.electron.ipcRenderer.on('queue:job-completed', onJobCompleted)

  // Auto-connect on startup if previously connected
  const host = settingsStore.settings.comfyui_host || 'localhost'
  const port = parseInt(settingsStore.settings.comfyui_port) || 8188
  connectionStore.connect(host, port).catch(() => {})
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeListener('comfyui:connection-changed', onConnectionChanged)
  window.electron.ipcRenderer.removeListener('queue:progress', onQueueProgress)
  window.electron.ipcRenderer.removeListener('queue:task-completed', onTaskCompleted)
  window.electron.ipcRenderer.removeListener('queue:task-failed', onTaskFailed)
  window.electron.ipcRenderer.removeListener('queue:job-completed', onJobCompleted)
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
