<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NButton,
  NSelect,
  NSpace,
  NDivider,
  NSwitch,
  NTag,
  NIcon,
  NAlert,
  useMessage
} from 'naive-ui'
import { CopyOutline, CheckmarkCircleOutline } from '@vicons/ionicons5'
import { useSettingsStore } from '@renderer/stores/settings.store'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useTerminalStore } from '@renderer/stores/terminal.store'
import { parseIntegerOrFallback } from '@renderer/utils/number'

const { t, locale } = useI18n()
const message = useMessage()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()

const host = ref('localhost')
const port = ref(8188)
const outputDir = ref('')
const mcpEnabled = ref(false)
const mcpPort = ref(39464)
const hasAnyCliConfig = computed(
  () =>
    terminalStore.mcpConfigStatus.claudeCode ||
    terminalStore.mcpConfigStatus.copilotCli ||
    terminalStore.mcpConfigStatus.geminiCli ||
    terminalStore.mcpConfigStatus.codexCli
)

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mergeErrorMessages(primaryError: string, rollbackError: string | null): string {
  return rollbackError
    ? `${primaryError} (${t('settings.mcp.msg.rollbackFailed', { error: rollbackError })})`
    : primaryError
}

async function syncMcpToggleState(): Promise<void> {
  await terminalStore.fetchMcpStatus()
  const isRunning = terminalStore.mcpStatus.isRunning
  mcpEnabled.value = isRunning
  settingsStore.settings.mcp_enabled = isRunning ? 'true' : 'false'
}

async function handleMcpEnabledChange(enabled: boolean): Promise<void> {
  if (enabled) {
    const result = await terminalStore.startMcpServer(mcpPort.value)
    if (!result.success) {
      mcpEnabled.value = false
      message.error(
        t('settings.mcp.msg.startFailed', {
          error: result.error ?? t('settings.mcp.msg.unknownError')
        })
      )
      return
    }

    try {
      await settingsStore.setSetting('mcp_enabled', 'true')
      mcpEnabled.value = true
    } catch (error) {
      let rollbackError: string | null = null

      try {
        await terminalStore.stopMcpServer()
      } catch (rollbackFailure) {
        rollbackError = getErrorMessage(rollbackFailure)
        await syncMcpToggleState()
      }

      if (!rollbackError) {
        mcpEnabled.value = false
      }

      message.error(
        t('settings.mcp.msg.enablePersistFailed', {
          error: mergeErrorMessages(getErrorMessage(error), rollbackError)
        })
      )
    }

    return
  }

  try {
    await terminalStore.stopMcpServer()
  } catch (error) {
    mcpEnabled.value = true
    message.error(
      t('settings.mcp.msg.stopFailed', {
        error: getErrorMessage(error)
      })
    )
    return
  }

  try {
    await settingsStore.setSetting('mcp_enabled', 'false')
    mcpEnabled.value = false
  } catch (error) {
    let rollbackError: string | null = null
    const rollback = await terminalStore.startMcpServer(mcpPort.value)

    if (!rollback.success) {
      rollbackError = rollback.error ?? t('settings.mcp.msg.unknownError')
      await syncMcpToggleState()
    } else {
      mcpEnabled.value = true
    }

    message.error(
      t('settings.mcp.msg.disablePersistFailed', {
        error: mergeErrorMessages(getErrorMessage(error), rollbackError)
      })
    )
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

async function handleSetupCli(): Promise<void> {
  const result = await terminalStore.setupMcpForCli()
  if (result.success) {
    await terminalStore.fetchMcpConfigStatus()
  }
}

async function handleRemoveCli(): Promise<void> {
  await terminalStore.removeMcpFromCli()
}

onMounted(async () => {
  await settingsStore.loadSettings()
  host.value = settingsStore.settings.comfyui_host
  port.value = parseIntegerOrFallback(settingsStore.settings.comfyui_port, 8188)
  outputDir.value = settingsStore.settings.output_directory
  mcpEnabled.value = settingsStore.settings.mcp_enabled === 'true'
  mcpPort.value = parseIntegerOrFallback(settingsStore.settings.mcp_port, 39464)
  await terminalStore.fetchMcpStatus()
})
</script>

<template>
  <div class="settings-view">
    <h2>{{ t('settings.title') }}</h2>

    <!-- Server Settings -->
    <NCard :title="t('settings.server.title')" style="margin-top: 16px">
      <NForm label-placement="left" label-width="140">
        <NFormItem :label="t('settings.server.host')">
          <NInput v-model:value="host" />
        </NFormItem>
        <NFormItem :label="t('settings.server.port')">
          <NInputNumber v-model:value="port" :min="1" :max="65535" />
        </NFormItem>
        <NFormItem>
          <NSpace>
            <NButton type="primary" :disabled="connectionStore.isConnected" @click="handleConnect">
              {{ t('settings.server.connect') }}
            </NButton>
            <NButton :disabled="!connectionStore.isConnected" @click="handleDisconnect">
              {{ t('settings.server.disconnect') }}
            </NButton>
          </NSpace>
        </NFormItem>
      </NForm>
    </NCard>

    <!-- Output Settings -->
    <NCard :title="t('settings.output.title')" style="margin-top: 16px">
      <NForm label-placement="left" label-width="140">
        <NFormItem :label="t('settings.output.directory')">
          <NSpace>
            <NInput v-model:value="outputDir" readonly style="flex: 1" />
            <NButton @click="handleBrowseOutput">
              {{ t('settings.output.browse') }}
            </NButton>
          </NSpace>
        </NFormItem>
        <NFormItem :label="t('settings.output.folderPattern')">
          <NInput
            :value="settingsStore.settings.output_pattern"
            placeholder="{job}/{character}/{outfit}/{emotion}"
            @update:value="(v: string) => handleSettingChange('output_pattern', v)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.output.filePattern')">
          <NInput
            :value="settingsStore.settings.filename_pattern"
            placeholder="{character}_{outfit}_{emotion}_{index}"
            @update:value="(v: string) => handleSettingChange('filename_pattern', v)"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <!-- General Settings -->
    <NCard :title="t('settings.general.title')" style="margin-top: 16px">
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
            :value="parseIntegerOrFallback(settingsStore.settings.max_retries, 3)"
            :min="0"
            :max="10"
            @update:value="(v: number | null) => handleSettingChange('max_retries', String(v ?? 3))"
          />
        </NFormItem>
        <NFormItem :label="t('settings.batch.autoSaveInterval')">
          <NInputNumber
            :value="parseIntegerOrFallback(settingsStore.settings.auto_save_interval, 5000)"
            :min="1000"
            :max="60000"
            :step="1000"
            @update:value="
              (v: number | null) => handleSettingChange('auto_save_interval', String(v ?? 5000))
            "
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NDivider />

    <!-- MCP Server Settings -->
    <NCard :title="t('settings.mcp.title')">
      <NAlert type="info" :bordered="false" style="margin-bottom: 16px">
        {{ t('settings.mcp.description') }}
      </NAlert>

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
              {{
                terminalStore.mcpStatus.isRunning
                  ? t('settings.mcp.running')
                  : t('settings.mcp.stopped')
              }}
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

      <NDivider style="margin: 12px 0" />

      <!-- CLI Auto-Connection -->
      <h4 style="margin: 0 0 12px 0">{{ t('settings.mcp.cliSetup.title') }}</h4>
      <p style="margin: 0 0 12px 0; color: var(--n-text-color3); font-size: 13px">
        {{ t('settings.mcp.cliSetup.description') }}
      </p>

      <NSpace vertical :size="12">
        <!-- Environment Variables -->
        <NAlert type="info" :title="t('settings.mcp.cliSetup.envTitle')" :bordered="false">
          <code>$COMFYUI_MCP_URL</code>, <code>$MCP_ENDPOINT</code>
          <br />
          <span style="font-size: 12px; color: var(--n-text-color3)">
            {{ t('settings.mcp.cliSetup.envDescription') }}
          </span>
        </NAlert>

        <!-- CLI Config Status -->
        <NSpace align="center" :size="8">
          <NButton
            size="small"
            :type="hasAnyCliConfig ? 'default' : 'primary'"
            :disabled="!terminalStore.mcpStatus.isRunning"
            @click="handleSetupCli"
          >
            {{
              hasAnyCliConfig
                ? t('settings.mcp.cliSetup.updateConfig')
                : t('settings.mcp.cliSetup.setupClaudeCode')
            }}
          </NButton>
          <NTag v-if="terminalStore.mcpConfigStatus.claudeCode" type="success" size="small" round>
            <template #icon><NIcon :component="CheckmarkCircleOutline" /></template>
            Claude Code ✓
          </NTag>
          <NTag v-if="terminalStore.mcpConfigStatus.copilotCli" type="success" size="small" round>
            <template #icon><NIcon :component="CheckmarkCircleOutline" /></template>
            Copilot CLI ✓
          </NTag>
          <NTag v-if="terminalStore.mcpConfigStatus.geminiCli" type="success" size="small" round>
            <template #icon><NIcon :component="CheckmarkCircleOutline" /></template>
            Gemini CLI ✓
          </NTag>
          <NTag v-if="terminalStore.mcpConfigStatus.codexCli" type="success" size="small" round>
            <template #icon><NIcon :component="CheckmarkCircleOutline" /></template>
            Codex CLI ✓
          </NTag>
          <NButton
            v-if="hasAnyCliConfig"
            size="tiny"
            quaternary
            type="error"
            @click="handleRemoveCli"
          >
            {{ t('settings.mcp.cliSetup.remove') }}
          </NButton>
        </NSpace>
        <span
          v-if="terminalStore.mcpConfigStatus.configPath"
          style="font-size: 12px; color: var(--n-text-color3)"
        >
          {{ terminalStore.mcpConfigStatus.configPath }}
        </span>
      </NSpace>
    </NCard>
  </div>
</template>
