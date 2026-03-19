<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, lightTheme } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import AppLayout from './components/layout/AppLayout.vue'
import { useSettingsStore } from './stores/settings.store'

const settingsStore = useSettingsStore()
const { locale } = useI18n()
const theme = ref<GlobalTheme | null>(darkTheme)

onMounted(async () => {
  await settingsStore.loadSettings()
  locale.value = settingsStore.settings.language || 'ko'
  updateTheme(settingsStore.settings.theme)
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
