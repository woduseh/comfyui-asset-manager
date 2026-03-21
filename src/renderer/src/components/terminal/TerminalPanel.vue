<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { NIcon, NButton, NSpace } from 'naive-ui'
import { AddOutline, CloseOutline, RemoveOutline, ExpandOutline } from '@vicons/ionicons5'
import TerminalInstance from './TerminalInstance.vue'
import { useTerminalStore } from '@renderer/stores/terminal.store'

const terminalStore = useTerminalStore()
const isResizing = ref(false)
const startY = ref(0)
const startHeight = ref(0)

const panelStyle = computed(() => ({
  height: `${terminalStore.panelHeight}px`
}))

function startResize(e: MouseEvent): void {
  isResizing.value = true
  startY.value = e.clientY
  startHeight.value = terminalStore.panelHeight

  const onMouseMove = (ev: MouseEvent): void => {
    if (!isResizing.value) return
    const delta = startY.value - ev.clientY
    terminalStore.panelHeight = Math.max(150, Math.min(600, startHeight.value + delta))
  }

  const onMouseUp = (): void => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

async function handleNewTab(): Promise<void> {
  await terminalStore.createTab()
}

async function handleCloseTab(id: string): Promise<void> {
  await terminalStore.closeTab(id)
}

function handleMinimize(): void {
  terminalStore.hidePanel()
}

function handleMaximize(): void {
  terminalStore.panelHeight = terminalStore.panelHeight >= 500 ? 300 : 600
}

onMounted(() => {
  if (terminalStore.tabs.length === 0) {
    terminalStore.createTab()
  }
})
</script>

<template>
  <div class="terminal-panel" :style="panelStyle">
    <div class="panel-resize-handle" @mousedown="startResize" />

    <div class="panel-toolbar">
      <NSpace align="center" :size="4" style="flex: 1; overflow-x: auto">
        <NButton
          v-for="tab in terminalStore.tabs"
          :key="tab.id"
          size="tiny"
          :type="tab.id === terminalStore.activeTabId ? 'primary' : 'default'"
          :quaternary="tab.id !== terminalStore.activeTabId"
          @click="terminalStore.setActiveTab(tab.id)"
        >
          {{ tab.title }}
          <template #icon>
            <NIcon
              :component="CloseOutline"
              style="cursor: pointer; margin-left: 4px"
              :size="12"
              @click.stop="handleCloseTab(tab.id)"
            />
          </template>
        </NButton>
        <NButton size="tiny" quaternary @click="handleNewTab">
          <template #icon><NIcon :component="AddOutline" /></template>
        </NButton>
      </NSpace>
      <NSpace :size="4">
        <NButton size="tiny" quaternary @click="handleMinimize">
          <template #icon><NIcon :component="RemoveOutline" /></template>
        </NButton>
        <NButton size="tiny" quaternary @click="handleMaximize">
          <template #icon><NIcon :component="ExpandOutline" /></template>
        </NButton>
      </NSpace>
    </div>

    <div class="panel-content">
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
.terminal-panel {
  display: flex;
  flex-direction: column;
  background: #1e1e2e;
  border-top: 1px solid var(--n-border-color);
  position: relative;
}

.panel-resize-handle {
  height: 4px;
  cursor: ns-resize;
  background: transparent;
  position: absolute;
  top: -2px;
  left: 0;
  right: 0;
  z-index: 10;
}

.panel-resize-handle:hover {
  background: rgba(99, 102, 241, 0.5);
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: rgba(30, 30, 46, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 32px;
}

.panel-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}
</style>
