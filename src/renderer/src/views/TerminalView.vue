<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NSpace, NTag, NTabs, NTabPane, NTooltip, NIcon } from 'naive-ui'
import { AddOutline, CopyOutline, ServerOutline } from '@vicons/ionicons5'
import TerminalInstance from '@renderer/components/terminal/TerminalInstance.vue'
import { useTerminalStore } from '@renderer/stores/terminal.store'

const { t } = useI18n()
const terminalStore = useTerminalStore()

const mcpStatusType = computed(() => {
  return terminalStore.mcpStatus.isRunning ? 'success' : 'default'
})

function handleTabChange(value: string): void {
  terminalStore.setActiveTab(value)
}

async function handleNewTab(): Promise<void> {
  await terminalStore.createTab()
}

async function handleCloseTab(id: string): Promise<void> {
  await terminalStore.closeTab(id)
}

async function handleToggleMcp(): Promise<void> {
  if (terminalStore.mcpStatus.isRunning) {
    await terminalStore.stopMcpServer()
  } else {
    await terminalStore.startMcpServer()
  }
}

function handleCopyUrl(): void {
  navigator.clipboard.writeText(terminalStore.mcpStatus.url)
}

onMounted(async () => {
  await terminalStore.fetchMcpStatus()
  if (terminalStore.tabs.length === 0) {
    await terminalStore.createTab()
  }
})
</script>

<template>
  <div class="terminal-view">
    <div class="terminal-header">
      <h2>{{ t('terminal.title') }}</h2>
      <NSpace align="center" :size="12">
        <NTag :type="mcpStatusType" size="small" round>
          <template #icon>
            <NIcon :component="ServerOutline" />
          </template>
          MCP
          {{
            terminalStore.mcpStatus.isRunning
              ? t('terminal.mcp.running')
              : t('terminal.mcp.stopped')
          }}
        </NTag>
        <NTooltip v-if="terminalStore.mcpStatus.isRunning">
          <template #trigger>
            <NButton size="tiny" quaternary @click="handleCopyUrl">
              <template #icon><NIcon :component="CopyOutline" /></template>
              {{ terminalStore.mcpStatus.url }}
            </NButton>
          </template>
          {{ t('terminal.mcp.copyUrl') }}
        </NTooltip>
        <NButton
          size="small"
          :type="terminalStore.mcpStatus.isRunning ? 'default' : 'primary'"
          @click="handleToggleMcp"
        >
          {{ terminalStore.mcpStatus.isRunning ? t('terminal.mcp.stop') : t('terminal.mcp.start') }}
        </NButton>
      </NSpace>
    </div>

    <div class="terminal-tabs-bar">
      <NTabs
        v-if="terminalStore.tabs.length > 0"
        type="card"
        :value="terminalStore.activeTabId || undefined"
        size="small"
        closable
        @update:value="handleTabChange"
        @close="handleCloseTab"
      >
        <NTabPane v-for="tab in terminalStore.tabs" :key="tab.id" :name="tab.id" :tab="tab.title" />
      </NTabs>
      <NButton size="small" quaternary style="margin-left: 4px" @click="handleNewTab">
        <template #icon><NIcon :component="AddOutline" /></template>
      </NButton>
    </div>

    <div class="terminal-content">
      <TerminalInstance
        v-for="tab in terminalStore.tabs"
        :key="tab.id"
        :terminal-id="tab.id"
        :active="tab.id === terminalStore.activeTabId"
      />
    </div>
  </div>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 88px);
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.terminal-header h2 {
  margin: 0;
}

.terminal-tabs-bar {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.terminal-tabs-bar :deep(.n-tabs) {
  flex: 1;
}

.terminal-content {
  flex: 1;
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: #1e1e2e;
  min-height: 200px;
}
</style>
