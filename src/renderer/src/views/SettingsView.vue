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
import { parseIntegerOrFallback } from '@shared/number'
import PageShell from '@renderer/components/common/PageShell.vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import ConfirmActionButton from '@renderer/components/common/ConfirmActionButton'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'

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
const hasAnyManagedCliConfig = computed(
  () =>
    terminalStore.mcpConfigStatus.claudeCode ||
    terminalStore.mcpConfigStatus.copilotCli ||
    terminalStore.mcpConfigStatus.geminiCli
)
const hasOutdatedMcpAuthConfig = computed(() => {
  if (!terminalStore.mcpAuthStatus.required) return false
  const status = terminalStore.mcpConfigStatus
  return (
    (status.claudeCode && !status.authReady.claudeCode) ||
    (status.copilotCli && !status.authReady.copilotCli) ||
    (status.geminiCli && !status.authReady.geminiCli) ||
    (status.codexCli && !status.authReady.codexCli)
  )
})
const mcpTokenEnvironmentVariable = 'COMFYUI_ASSET_MANAGER_MCP_TOKEN'
const codexAddCommand = computed(
  () =>
    `codex mcp add comfyui-asset-manager --url ${terminalStore.mcpStatus.url} --bearer-token-env-var ${mcpTokenEnvironmentVariable}`
)
const codexTokenCommand = computed(
  () =>
    `[Environment]::SetEnvironmentVariable('${mcpTokenEnvironmentVariable}','${terminalStore.mcpAuthStatus.token}','User')`
)
const codexRemoveCommand = 'codex mcp remove comfyui-asset-manager'

const languageOptions = [
  { label: '한국어', value: 'ko' },
  { label: 'English', value: 'en' }
]

const themeOptions = computed(() => [
  { label: t('settings.general.dark'), value: 'dark' },
  { label: t('settings.general.light'), value: 'light' }
])

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
  const dir = await invokeIpc(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY)
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

async function handleMcpAuthRequiredChange(required: boolean): Promise<void> {
  try {
    await terminalStore.setMcpAuthRequired(required)
    settingsStore.settings.mcp_auth_required = required ? 'true' : 'false'
  } catch (error) {
    message.error(t('settings.mcp.auth.updateFailed', { error: getErrorMessage(error) }))
    await terminalStore.fetchMcpAuthStatus()
  }
}

async function handleCopyMcpToken(): Promise<void> {
  await navigator.clipboard.writeText(terminalStore.mcpAuthStatus.token)
  message.success(t('settings.mcp.auth.tokenCopied'))
}

async function handleRotateMcpToken(): Promise<void> {
  try {
    await terminalStore.rotateMcpAuthToken()
    message.success(t('settings.mcp.auth.rotated'))
  } catch (error) {
    message.error(t('settings.mcp.auth.rotateFailed', { error: getErrorMessage(error) }))
  }
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

async function handleCopyCodexCommand(command: string, messageKey: string): Promise<void> {
  await navigator.clipboard.writeText(command)
  message.success(t(messageKey))
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
  <PageShell width="compact" class="settings-view">
    <PageHeader :title="t('settings.title')" :description="t('settings.pageDescription')" />

    <!-- Server Settings -->
    <NCard :title="t('settings.server.title')" style="margin-top: 16px">
      <NForm label-placement="left" label-width="140">
        <NFormItem :label="t('settings.server.host')">
          <NInput v-model:value="host" :aria-label="t('settings.server.host')" />
        </NFormItem>
        <NFormItem :label="t('settings.server.port')">
          <NInputNumber
            v-model:value="port"
            :min="1"
            :max="65535"
            :aria-label="t('settings.server.port')"
          />
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
            <NInput
              v-model:value="outputDir"
              readonly
              style="flex: 1"
              :aria-label="t('settings.output.directory')"
            />
            <NButton @click="handleBrowseOutput">
              {{ t('settings.output.browse') }}
            </NButton>
          </NSpace>
        </NFormItem>
        <NFormItem :label="t('settings.output.folderPattern')">
          <NInput
            :value="settingsStore.settings.output_pattern"
            placeholder="{job}/{character}/{outfit}/{emotion}"
            :aria-label="t('settings.output.folderPattern')"
            @update:value="(v: string) => handleSettingChange('output_pattern', v)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.output.filePattern')">
          <NInput
            :value="settingsStore.settings.filename_pattern"
            placeholder="{character}_{outfit}_{emotion}_{index}"
            :aria-label="t('settings.output.filePattern')"
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
            :aria-label="t('settings.general.language')"
            @update:value="handleLanguageChange"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.theme')">
          <NSelect
            :value="settingsStore.settings.theme"
            :options="themeOptions"
            :aria-label="t('settings.general.theme')"
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
            :aria-label="t('settings.batch.maxRetries')"
            @update:value="(v: number | null) => handleSettingChange('max_retries', String(v ?? 3))"
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
          <NSwitch
            :value="mcpEnabled"
            :aria-label="t('settings.mcp.enabled')"
            @update:value="handleMcpEnabledChange"
          />
        </NFormItem>
        <NFormItem :label="t('settings.mcp.port')">
          <NInputNumber
            :value="mcpPort"
            :min="1024"
            :max="65535"
            :disabled="terminalStore.mcpStatus.isRunning"
            :aria-label="t('settings.mcp.port')"
            @update:value="handleMcpPortChange"
          />
        </NFormItem>
        <NFormItem :label="t('settings.mcp.auth.required')">
          <NSwitch
            :value="terminalStore.mcpAuthStatus.required"
            :aria-label="t('settings.mcp.auth.required')"
            @update:value="handleMcpAuthRequiredChange"
          />
        </NFormItem>
        <NFormItem
          v-if="terminalStore.mcpAuthStatus.required"
          :label="t('settings.mcp.auth.token')"
        >
          <NSpace vertical style="width: 100%">
            <NInput
              :value="terminalStore.mcpAuthStatus.token"
              type="password"
              show-password-on="click"
              readonly
              :aria-label="t('settings.mcp.auth.token')"
            />
            <NSpace :size="8">
              <NButton size="small" @click="handleCopyMcpToken">
                {{ t('settings.mcp.auth.copyToken') }}
              </NButton>
              <ConfirmActionButton
                size="small"
                type="warning"
                quaternary
                :label="t('settings.mcp.auth.rotate')"
                :confirm-text="t('settings.mcp.auth.rotateConfirm')"
                @confirm="handleRotateMcpToken"
              />
            </NSpace>
          </NSpace>
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

      <!-- MCP client connection -->
      <h4 style="margin: 0 0 12px 0">{{ t('settings.mcp.cliSetup.title') }}</h4>
      <p style="margin: 0 0 12px 0; color: var(--n-text-color3); font-size: 13px">
        {{ t('settings.mcp.cliSetup.description') }}
      </p>

      <NSpace vertical :size="12">
        <NAlert
          v-if="hasOutdatedMcpAuthConfig"
          type="warning"
          :title="t('settings.mcp.auth.configUpdateTitle')"
          :bordered="false"
        >
          {{ t('settings.mcp.auth.configUpdateDescription') }}
        </NAlert>

        <!-- Environment Variables -->
        <NAlert type="info" :title="t('settings.mcp.cliSetup.envTitle')" :bordered="false">
          <code>$COMFYUI_MCP_URL</code>, <code>$MCP_ENDPOINT</code>,
          <code>{{ '$' + mcpTokenEnvironmentVariable }}</code>
          <br />
          <span style="font-size: 12px; color: var(--n-text-color3)">
            {{ t('settings.mcp.cliSetup.envDescription') }}
          </span>
        </NAlert>

        <!-- Codex uses its official one-time CLI registration flow. -->
        <div class="codex-setup">
          <div class="codex-setup__header">
            <div>
              <strong>{{ t('settings.mcp.cliSetup.codexTitle') }}</strong>
              <p>{{ t('settings.mcp.cliSetup.codexDescription') }}</p>
            </div>
            <NTag
              :type="terminalStore.mcpConfigStatus.codexCli ? 'success' : 'default'"
              size="small"
              round
            >
              {{
                terminalStore.mcpConfigStatus.codexCli
                  ? t('settings.mcp.cliSetup.codexRegistered')
                  : t('settings.mcp.cliSetup.codexNotRegistered')
              }}
            </NTag>
          </div>
          <code class="codex-setup__command">{{ codexAddCommand }}</code>
          <NSpace :size="8" :wrap="true">
            <NButton
              v-if="terminalStore.mcpAuthStatus.required"
              size="small"
              @click="
                handleCopyCodexCommand(
                  codexTokenCommand,
                  'settings.mcp.auth.codexTokenCommandCopied'
                )
              "
            >
              <template #icon><NIcon :component="CopyOutline" /></template>
              {{ t('settings.mcp.auth.copyCodexTokenCommand') }}
            </NButton>
            <NButton
              size="small"
              @click="
                handleCopyCodexCommand(codexAddCommand, 'settings.mcp.cliSetup.codexCommandCopied')
              "
            >
              <template #icon><NIcon :component="CopyOutline" /></template>
              {{ t('settings.mcp.cliSetup.copyCodexCommand') }}
            </NButton>
            <NButton
              v-if="terminalStore.mcpConfigStatus.codexCli"
              size="small"
              quaternary
              @click="
                handleCopyCodexCommand(
                  codexRemoveCommand,
                  'settings.mcp.cliSetup.codexRemoveCommandCopied'
                )
              "
            >
              {{ t('settings.mcp.cliSetup.copyCodexRemoveCommand') }}
            </NButton>
          </NSpace>
          <span class="codex-setup__hint">{{ t('settings.mcp.cliSetup.codexHint') }}</span>
        </div>

        <!-- Explicitly managed non-Codex CLI configs -->
        <strong class="managed-cli-title">{{ t('settings.mcp.cliSetup.managedTitle') }}</strong>
        <NSpace align="center" :size="8">
          <NButton
            size="small"
            :type="hasAnyManagedCliConfig ? 'default' : 'primary'"
            :disabled="!terminalStore.mcpStatus.isRunning"
            @click="handleSetupCli"
          >
            {{
              hasAnyManagedCliConfig
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
          <NButton
            v-if="hasAnyManagedCliConfig"
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
  </PageShell>
</template>

<style scoped>
.codex-setup {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--n-border-color);
  border-radius: var(--radius-md);
  background: var(--app-surface-muted);
}

.codex-setup__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.codex-setup__header p {
  margin: 4px 0 0;
  color: var(--app-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.codex-setup__command {
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(128, 128, 128, 0.12);
  font-size: 12px;
  white-space: nowrap;
}

.codex-setup__hint {
  color: var(--app-text-muted);
  font-size: 11px;
}

.managed-cli-title {
  margin-top: 4px;
  font-size: 13px;
}
</style>
