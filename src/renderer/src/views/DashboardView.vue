<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NCard, NGrid, NGridItem, NStatistic, NSpace, NEmpty, NButton,
  NTag, NList, NListItem, NThing, NDivider
} from 'naive-ui'
import { useQueueStore } from '@renderer/stores/queue.store'
import { useConnectionStore } from '@renderer/stores/connection.store'

const { t } = useI18n()
const router = useRouter()
const queueStore = useQueueStore()
const connectionStore = useConnectionStore()

interface DashboardStats {
  totalImages: number
  favoriteCount: number
  totalJobs: number
  completedJobs: number
  totalWorkflows: number
  totalModules: number
  recentImages: Array<{
    id: string
    file_path: string
    character_name: string | null
    emotion_name: string | null
    created_at: string
  }>
}

const stats = ref<DashboardStats | null>(null)

async function loadStats(): Promise<void> {
  try {
    stats.value = await window.electron.ipcRenderer.invoke('dashboard:stats')
  } catch { /* ignore */ }
}

async function connectServer(): Promise<void> {
  await connectionStore.connect()
  if (connectionStore.isConnected) {
    await connectionStore.fetchSystemStats()
  }
}

onMounted(async () => {
  await loadStats()
  queueStore.loadActiveJobs()
  if (connectionStore.isConnected) {
    await connectionStore.fetchSystemStats()
  }
})
</script>

<template>
  <div class="dashboard-view">
    <h2>{{ t('nav.dashboard') }}</h2>

    <!-- Connection Status -->
    <NCard style="margin-top: 16px;">
      <NGrid :cols="4" :x-gap="16">
        <NGridItem>
          <NSpace align="center">
            <div :style="{ width: '12px', height: '12px', borderRadius: '50%', background: connectionStore.isConnected ? '#63e2b7' : '#e06c75' }" />
            <NStatistic
              :label="t('connection.' + connectionStore.connectionState)"
              :value="connectionStore.isConnected ? `${connectionStore.status.host}:${connectionStore.status.port}` : '-'"
            />
          </NSpace>
          <NButton v-if="!connectionStore.isConnected" size="small" type="primary" style="margin-top: 8px;" @click="connectServer">
            {{ t('settings.server.connect') }}
          </NButton>
        </NGridItem>
        <NGridItem>
          <NStatistic label="실행 중 작업" :value="queueStore.activeJobs.length" />
        </NGridItem>
        <NGridItem>
          <NStatistic label="전체 진행률" :value="queueStore.totalProgress + '%'" />
        </NGridItem>
        <NGridItem>
          <NStatistic label="GPU" :value="connectionStore.status.systemStats ? '사용 가능' : '-'" />
        </NGridItem>
      </NGrid>
    </NCard>

    <!-- Statistics -->
    <template v-if="stats">
      <NGrid :cols="6" :x-gap="12" :y-gap="12" style="margin-top: 16px;">
        <NGridItem>
          <NCard size="small" hoverable style="cursor: pointer;" @click="router.push('/gallery')">
            <NStatistic label="총 이미지" :value="stats.totalImages" />
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" hoverable>
            <NStatistic label="즐겨찾기" :value="stats.favoriteCount" />
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" hoverable style="cursor: pointer;" @click="router.push('/batch')">
            <NStatistic label="배치 작업" :value="stats.totalJobs" />
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small">
            <NStatistic label="완료된 작업" :value="stats.completedJobs" />
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" hoverable style="cursor: pointer;" @click="router.push('/workflows')">
            <NStatistic label="워크플로우" :value="stats.totalWorkflows" />
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" hoverable style="cursor: pointer;" @click="router.push('/modules')">
            <NStatistic label="모듈" :value="stats.totalModules" />
          </NCard>
        </NGridItem>
      </NGrid>

      <!-- Recent images -->
      <NCard title="최근 생성 이미지" style="margin-top: 16px;">
        <template v-if="stats.recentImages.length > 0">
          <NList bordered>
            <NListItem v-for="img in stats.recentImages" :key="img.id">
              <NThing
                :title="[img.character_name, img.emotion_name].filter(Boolean).join(' - ') || '이미지'"
                :description="img.created_at"
              >
                <template #header-extra>
                  <NTag size="tiny" round>{{ img.file_path.split(/[/\\]/).pop() }}</NTag>
                </template>
              </NThing>
            </NListItem>
          </NList>
        </template>
        <NEmpty v-else :description="'아직 생성된 이미지가 없습니다. 워크플로우를 등록하고 배치 작업을 시작해보세요.'" />
      </NCard>

      <!-- Quick actions -->
      <NDivider />
      <NSpace>
        <NButton type="primary" @click="router.push('/workflows')">워크플로우 등록</NButton>
        <NButton @click="router.push('/modules')">모듈 관리</NButton>
        <NButton @click="router.push('/batch')">배치 작업 만들기</NButton>
      </NSpace>
    </template>
  </div>
</template>
