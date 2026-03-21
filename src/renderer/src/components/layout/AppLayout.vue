<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NMenu,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NIcon,
  NButton,
  NSpace,
  NTag,
  NBadge
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { h } from 'vue'
import {
  GitNetworkOutline,
  CubeOutline,
  FlashOutline,
  ImagesOutline,
  SettingsOutline,
  TerminalOutline,
  DiamondOutline
} from '@vicons/ionicons5'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useQueueStore } from '@renderer/stores/queue.store'
import { useTerminalStore } from '@renderer/stores/terminal.store'
import TerminalPanel from '@renderer/components/terminal/TerminalPanel.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()
const terminalStore = useTerminalStore()
const sidebarCollapsed = ref(false)

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const mainMenuOptions = computed<MenuOption[]>(() => [
  {
    label: t('nav.workflows'),
    key: 'workflows',
    icon: renderIcon(GitNetworkOutline)
  },
  {
    label: t('nav.modules'),
    key: 'modules',
    icon: renderIcon(CubeOutline)
  },
  {
    label: () =>
      h('span', {}, [
        t('nav.jobs'),
        queueStore.isProcessing
          ? h(NBadge, {
              value: queueStore.totalProgress + '%',
              type: 'info',
              style: 'margin-left: 8px'
            })
          : null
      ]),
    key: 'jobs',
    icon: renderIcon(FlashOutline)
  },
  {
    label: t('nav.gallery'),
    key: 'gallery',
    icon: renderIcon(ImagesOutline)
  },
  {
    label: t('nav.terminal'),
    key: 'terminal',
    icon: renderIcon(TerminalOutline)
  }
])

const settingsMenuOptions = computed<MenuOption[]>(() => [
  {
    label: t('nav.settings'),
    key: 'settings',
    icon: renderIcon(SettingsOutline)
  }
])

const activeKey = computed(() => {
  return (route.name as string) || 'workflows'
})

function handleMenuUpdate(key: string): void {
  router.push({ name: key })
}

async function handleToggleConnection(): Promise<void> {
  if (connectionStore.isConnected) {
    await connectionStore.disconnect()
  } else {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll')
    const host = settings?.comfyui_host || 'localhost'
    const port = parseInt(settings?.comfyui_port) || 8188
    await connectionStore.connect(host, port)
  }
}
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      v-model:collapsed="sidebarCollapsed"
      bordered
      :width="200"
      :collapsed-width="64"
      collapse-mode="width"
      show-trigger
      content-style="display: flex; flex-direction: column; height: 100%;"
    >
      <div class="app-logo">
        <Transition name="logo-fade" mode="out-in">
          <NIcon v-if="sidebarCollapsed" :size="24" class="logo-icon">
            <DiamondOutline />
          </NIcon>
          <span v-else class="logo-text">ComfyUI AM</span>
        </Transition>
      </div>

      <NMenu
        :options="mainMenuOptions"
        :value="activeKey"
        style="flex: 1"
        @update:value="handleMenuUpdate"
      />

      <NMenu :options="settingsMenuOptions" :value="activeKey" @update:value="handleMenuUpdate" />
    </NLayoutSider>

    <NLayout>
      <NLayoutHeader
        bordered
        style="
          height: 48px;
          padding: 0 20px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
        "
      >
        <NSpace align="center" :size="12">
          <NButton
            size="tiny"
            :type="terminalStore.panelVisible ? 'primary' : 'default'"
            quaternary
            :title="t('terminal.togglePanel')"
            @click="terminalStore.togglePanel()"
          >
            <template #icon>
              <NIcon :component="TerminalOutline" />
            </template>
          </NButton>
          <NTag :type="connectionStore.isConnected ? 'success' : 'error'" size="small" round>
            <template #icon>
              <div class="status-dot" :class="{ connected: connectionStore.isConnected }" />
            </template>
            {{
              connectionStore.isConnected ? t('connection.connected') : t('connection.disconnected')
            }}
          </NTag>
          <NButton
            size="tiny"
            :type="connectionStore.isConnected ? 'default' : 'primary'"
            :loading="connectionStore.isConnecting"
            @click="handleToggleConnection"
          >
            {{ connectionStore.isConnected ? t('connection.disconnect') : t('connection.connect') }}
          </NButton>
        </NSpace>
      </NLayoutHeader>

      <NLayout
        content-style="padding: 20px; overflow: auto;"
        :style="{
          height: terminalStore.panelVisible
            ? `calc(100vh - 48px - ${terminalStore.panelHeight}px)`
            : 'calc(100vh - 48px)'
        }"
      >
        <router-view />
      </NLayout>

      <TerminalPanel v-if="terminalStore.panelVisible" />
    </NLayout>
  </NLayout>
</template>

<style scoped>
.app-logo {
  padding: 14px;
  text-align: center;
  font-weight: bold;
  font-size: 17px;
  border-bottom: 1px solid var(--n-border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
}

.logo-text {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  white-space: nowrap;
}

.logo-icon {
  color: #8b5cf6;
}

.logo-fade-enter-active,
.logo-fade-leave-active {
  transition: opacity 0.15s ease;
}

.logo-fade-enter-from,
.logo-fade-leave-to {
  opacity: 0;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  transition: background 0.3s;
}

.status-dot.connected {
  background: #22c55e;
}

/* Sidebar smooth styling */
:deep(.n-menu-item-content) {
  transition:
    background 0.2s ease,
    color 0.2s ease !important;
  border-radius: 8px !important;
  margin: 2px 6px !important;
}
</style>
