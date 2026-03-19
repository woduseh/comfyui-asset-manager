<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NMenu, NLayout, NLayoutSider, NIcon, NBadge } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { h } from 'vue'
import {
  GridOutline,
  GitNetworkOutline,
  CubeOutline,
  LayersOutline,
  ListOutline,
  ImagesOutline,
  SettingsOutline
} from '@vicons/ionicons5'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useQueueStore } from '@renderer/stores/queue.store'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()

function renderIcon(icon: ReturnType<typeof GridOutline>) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions = computed<MenuOption[]>(() => [
  {
    label: t('nav.dashboard'),
    key: 'dashboard',
    icon: renderIcon(GridOutline)
  },
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
    label: t('nav.batch'),
    key: 'batch',
    icon: renderIcon(LayersOutline)
  },
  {
    label: () =>
      h('span', {}, [
        t('nav.queue'),
        queueStore.isProcessing
          ? h(NBadge, { value: queueStore.totalProgress + '%', type: 'info', style: 'margin-left: 8px' })
          : null
      ]),
    key: 'queue',
    icon: renderIcon(ListOutline)
  },
  {
    label: t('nav.gallery'),
    key: 'gallery',
    icon: renderIcon(ImagesOutline)
  },
  {
    label: t('nav.settings'),
    key: 'settings',
    icon: renderIcon(SettingsOutline)
  }
])

const activeKey = computed(() => {
  return route.name as string || 'dashboard'
})

function handleMenuUpdate(key: string): void {
  router.push({ name: key })
}
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      bordered
      :width="220"
      :collapsed-width="64"
      collapse-mode="width"
      show-trigger
      content-style="padding: 8px 0;"
    >
      <div class="app-logo">
        <span class="logo-text">ComfyUI AM</span>
      </div>

      <NMenu
        :options="menuOptions"
        :value="activeKey"
        @update:value="handleMenuUpdate"
      />

      <div class="connection-status">
        <div
          class="status-dot"
          :class="{ connected: connectionStore.isConnected }"
        />
        <span class="status-text">
          {{ connectionStore.isConnected ? t('connection.connected') : t('connection.disconnected') }}
        </span>
      </div>
    </NLayoutSider>

    <NLayout content-style="padding: 24px;">
      <router-view />
    </NLayout>
  </NLayout>
</template>

<style scoped>
.app-logo {
  padding: 16px;
  text-align: center;
  font-weight: bold;
  font-size: 18px;
  border-bottom: 1px solid var(--n-border-color);
  margin-bottom: 8px;
}

.logo-text {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.connection-status {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
  opacity: 0.7;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  transition: background 0.3s;
}

.status-dot.connected {
  background: #22c55e;
}

.status-text {
  white-space: nowrap;
}
</style>
