<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, lightTheme } from 'naive-ui'
import AppLayout from './components/layout/AppLayout.vue'
import { useSettingsStore } from './stores/settings.store'
import { useConnectionStore } from './stores/connection.store'
import { useQueueStore } from './stores/queue.store'
import type { QueueTaskCompletedEvent, QueueTaskFailedEvent } from '@shared/ipc-contract'
import { parseIntegerOrFallback } from '@shared/number'
import { onIpc } from './utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { darkThemeOverrides, lightThemeOverrides } from './theme-overrides'

const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()
const { locale } = useI18n()
const theme = computed(() => (settingsStore.settings.theme === 'light' ? lightTheme : darkTheme))
const themeOverrides = computed(() =>
  settingsStore.settings.theme === 'light' ? lightThemeOverrides : darkThemeOverrides
)

const eventCleanups: Array<() => void> = []

const onConnectionChanged = (connected: boolean): void => {
  connectionStore.setConnectionChanged(connected)
}

const onTaskCompleted = (data: QueueTaskCompletedEvent): void => {
  if (!('jobId' in data)) return
  queueStore.onTaskCompleted(data)
}

const onTaskFailed = (data: QueueTaskFailedEvent): void => {
  if (!('jobId' in data)) return
  queueStore.onTaskFailed(data)
}

const onJobCompleted = (data: { jobId: string }): void => {
  queueStore.onJobCompleted(data.jobId)
}

onMounted(async () => {
  await settingsStore.loadSettings()
  locale.value = settingsStore.settings.language || 'ko'

  // Listen for main→renderer events
  eventCleanups.push(
    onIpc(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, onConnectionChanged),
    onIpc(IPC_CHANNELS.QUEUE_TASK_COMPLETED, onTaskCompleted),
    onIpc(IPC_CHANNELS.QUEUE_TASK_FAILED, onTaskFailed),
    onIpc(IPC_CHANNELS.QUEUE_JOB_COMPLETED, onJobCompleted)
  )

  // Auto-connect on startup if previously connected
  const host = settingsStore.settings.comfyui_host || 'localhost'
  const port = parseIntegerOrFallback(settingsStore.settings.comfyui_port, 8188)
  // connect() surfaces failures through store state and never rejects.
  await connectionStore.connect(host, port)
})

onUnmounted(() => {
  for (const cleanup of eventCleanups.splice(0)) {
    cleanup()
  }
})
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :class="{ 'app-theme-light': settingsStore.settings.theme === 'light' }"
  >
    <NMessageProvider>
      <NDialogProvider>
        <AppLayout />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
