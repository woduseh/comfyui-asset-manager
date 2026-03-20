<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NForm, NFormItem, NInput, NInputNumber, NButton, NSelect, NSpace, NDivider, NSwitch, NTag, NIcon
} from 'naive-ui'
import { CopyOutline } from '@vicons/ionicons5'
import { useSettingsStore } from '@renderer/stores/settings.store'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useTerminalStore } from '@renderer/stores/terminal.store'

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()

const host = ref('localhost')
const port = ref(8188)
const outputDir = ref('')
const mcpEnabled = ref(false)
const mcpPort = ref(39464)

const languageOptions = [
  { label: '한국어', value: 'ko' },
  { label: 'English', value: 'en' }
]

const themeOptions = [
  { label: t('settings.general.dark'), value: 'dark' },
  { label: t('settings.general.light'), value: 'light' }
]

async function handleConnect(): Promise<void> {
  const success = await connectionStore.connect(host.value, port.value)
  if (success) {
    await settingsStore.setSetting('comfyui_host', host.value)
    await settingsStore.setSetting('comfyui_port', String(port.value))
  }
}

async function handleDisconnect(): Promise<void> {
  await connectionStore.disconnect()
}

async function handleBrowseOutput(): Promise<void> {
  const dir = await window.electron.ipcRenderer.invoke('dialog:open-directory')
  if (dir) {
    outputDir.value = dir
    await settingsStore.setSetting('output_directory', dir)
  }
}

async function handleLanguageChange(value: string): Promise<void> {
  await settingsStore.setSetting('language', value)
  locale.value = value
}

async function handleThemeChange(value: string): Promise<void> {
  await settingsStore.setSetting('theme', value)
}

async function handleSettingChange(key: string, value: string): Promise<void> {
  await settingsStore.setSetting(key, value)
}

async function handleMcpEnabledChange(enabled: boolean): Promise<void> {
  mcpEnabled.value = enabled
  await settingsStore.setSetting('mcp_enabled', String(enabled))
  if (enabled) {
    await terminalStore.startMcpServer(mcpPort.value)
  } else {
    await terminalStore.stopMcpServer()
  }
}

async function handleMcpPortChange(value: number | null): Promise<void> {
  const p = value ?? 39464
  mcpPort.value = p
  await settingsStore.setSetting('mcp_port', String(p))
}

function handleCopyMcpUrl(): void {
  navigator.clipboard.writeText(terminalStore.mcpStatus.url)
}

onMounted(async () => {
  await settingsStore.loadSettings()
  host.value = settingsStore.settings.comfyui_host
  port.value = parseInt(settingsStore.settings.comfyui_port) || 8188
  outputDir.value = settingsStore.settings.output_directory
  mcpEnabled.value = settingsStore.settings.mcp_enabled === 'true'
  mcpPort.value = parseInt(settingsStore.settings.mcp_port) || 39464
  await terminalStore.fetchMcpStatus()
})
</script>

<template>
  <div class="settings-view">
    <h2>{{ t('settings.title') }}</h2>

    <!-- Server Settings -->
    <NCard :title="t('settings.server.title')" style="margin-top: 16px;">
      <NForm label-placement="left" label-width="140">
        <NFormItem :label="t('settings.server.host')">
          <NInput v-model:value="host" />
        </NFormItem>
        <NFormItem :label="t('settings.server.port')">
          <NInputNumber v-model:value="port" :min="1" :max="65535" />
        </NFormItem>
        <NFormItem>
          <NSpace>
            <NButton
              type="primary"
              :disabled="connectionStore.isConnected"
              @click="handleConnect"
            >
              {{ t('settings.server.connect') }}
            </NButton>
            <NButton
              :disabled="!connectionStore.isConnected"
              @click="handleDisconnect"
            >
              {{ t('settings.server.disconnect') }}
            </NButton>
          </NSpace>
        </NFormItem>
      </NForm>
    </NCard>

    <!-- Output Settings -->
    <NCard :title="t('settings.output.title')" style="margin-top: 16px;">
      <NForm label-placement="left" label-width="140">
        <NFormItem :label="t('settings.output.directory')">
          <NSpace>
            <NInput v-model:value="outputDir" readonly style="flex: 1;" />
            <NButton @click="handleBrowseOutput">
              {{ t('settings.output.browse') }}
            </NButton>
          </NSpace>
        </NFormItem>
        <NFormItem :label="t('settings.output.folderPattern')">
          <NInput
            :value="settingsStore.settings.output_pattern"
            @update:value="(v: string) => handleSettingChange('output_pattern', v)"
            placeholder="{job}/{character}/{outfit}/{emotion}"
          />
        </NFormItem>
        <NFormItem :label="t('settings.output.filePattern')">
          <NInput
            :value="settingsStore.settings.filename_pattern"
            @update:value="(v: string) => handleSettingChange('filename_pattern', v)"
            placeholder="{character}_{outfit}_{emotion}_{index}"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <!-- General Settings -->
    <NCard :title="t('settings.general.title')" style="margin-top: 16px;">
      <NForm label-placement="left" label-width="140">
        <NFormItem :label="t('settings.general.language')">
          <NSelect
            :value="settingsStore.settings.language"
            :options="languageOptions"
            @update:value="handleLanguageChange"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.theme')">
          <NSelect
            :value="settingsStore.settings.theme"
            :options="themeOptions"
            @update:value="handleThemeChange"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NDivider />

    <!-- Batch Settings -->
    <NCard :title="t('settings.batch.title')">
      <NForm label-placement="left" label-width="200">
        <NFormItem :label="t('settings.batch.maxRetries')">
          <NInputNumber
            :value="parseInt(settingsStore.settings.max_retries)"
            :min="0"
            :max="10"
            @update:value="(v: number | null) => handleSettingChange('max_retries', String(v ?? 3))"
          />
        </NFormItem>
        <NFormItem :label="t('settings.batch.autoSaveInterval')">
          <NInputNumber
            :value="parseInt(settingsStore.settings.auto_save_interval)"
            :min="1000"
            :max="60000"
            :step="1000"
            @update:value="(v: number | null) => handleSettingChange('auto_save_interval', String(v ?? 5000))"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NDivider />

    <!-- MCP Server Settings -->
    <NCard :title="t('settings.mcp.title')">
      <NForm label-placement="left" label-width="200">
        <NFormItem :label="t('settings.mcp.enabled')">
          <NSwitch :value="mcpEnabled" @update:value="handleMcpEnabledChange" />
        </NFormItem>
        <NFormItem :label="t('settings.mcp.port')">
          <NInputNumber
            :value="mcpPort"
            :min="1024"
            :max="65535"
            :disabled="terminalStore.mcpStatus.isRunning"
            @update:value="handleMcpPortChange"
          />
        </NFormItem>
        <NFormItem :label="t('settings.mcp.status')">
          <NSpace align="center" :size="8">
            <NTag
              :type="terminalStore.mcpStatus.isRunning ? 'success' : 'default'"
              size="small"
              round
            >
              {{ terminalStore.mcpStatus.isRunning ? t('settings.mcp.running') : t('settings.mcp.stopped') }}
            </NTag>
            <NButton
              v-if="terminalStore.mcpStatus.isRunning"
              size="tiny"
              quaternary
              @click="handleCopyMcpUrl"
            >
              <template #icon><NIcon :component="CopyOutline" /></template>
              {{ terminalStore.mcpStatus.url }}
            </NButton>
          </NSpace>
        </NFormItem>
      </NForm>
    </NCard>
  </div>
</template>
