<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NTabs, NTabPane, NTooltip, NIcon } from 'naive-ui'
import { AddOutline, CopyOutline, ServerOutline } from '@vicons/ionicons5'
import TerminalInstance from '@renderer/components/terminal/TerminalInstance.vue'
import { useTerminalStore } from '@renderer/stores/terminal.store'
import PageShell from '@renderer/components/common/PageShell.vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'

const { t } = useI18n()
const terminalStore = useTerminalStore()

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
  <PageShell class="terminal-view">
    <PageHeader :title="t('terminal.title')" :description="t('terminal.pageDescription')">
      <template #actions>
        <div class="mcp-control">
          <NIcon :component="ServerOutline" :size="17" />
          <div class="mcp-control__copy">
            <strong>{{ t('terminal.mcp.serverLabel') }}</strong>
            <span>
              {{
                terminalStore.mcpStatus.isRunning
                  ? t('terminal.mcp.running')
                  : t('terminal.mcp.stopped')
              }}
            </span>
          </div>
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
            {{
              terminalStore.mcpStatus.isRunning ? t('terminal.mcp.stop') : t('terminal.mcp.start')
            }}
          </NButton>
        </div>
      </template>
    </PageHeader>

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
  </PageShell>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 88px);
}

.mcp-control {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 7px 6px 10px;
  border: 1px solid var(--n-border-color);
  border-radius: 10px;
  background: var(--app-surface-muted);
}

.mcp-control__copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

.mcp-control__copy strong {
  font-size: 11px;
}

.mcp-control__copy span {
  color: var(--app-text-muted);
  font-size: 10px;
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
