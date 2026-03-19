<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NCard, NGrid, NGridItem, NStatistic, NSpace, NEmpty } from 'naive-ui'
import { useQueueStore } from '@renderer/stores/queue.store'
import { useConnectionStore } from '@renderer/stores/connection.store'

const { t } = useI18n()
const queueStore = useQueueStore()
const connectionStore = useConnectionStore()
</script>

<template>
  <div class="dashboard-view">
    <h2>{{ t('nav.dashboard') }}</h2>

    <NGrid :cols="4" :x-gap="16" :y-gap="16" style="margin-top: 16px;">
      <NGridItem>
        <NCard>
          <NStatistic label="서버 상태" :value="connectionStore.isConnected ? '연결됨' : '연결 안 됨'" />
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard>
          <NStatistic label="실행 중 작업" :value="queueStore.activeJobs.length" />
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard>
          <NStatistic label="전체 진행률" :value="queueStore.totalProgress + '%'" />
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard>
          <NStatistic label="GPU 상태" :value="connectionStore.status.systemStats ? '사용 가능' : '-'" />
        </NCard>
      </NGridItem>
    </NGrid>

    <NCard title="최근 활동" style="margin-top: 24px;">
      <NSpace vertical>
        <NEmpty :description="'아직 활동이 없습니다. 워크플로우를 등록하고 배치 작업을 시작해보세요.'" />
      </NSpace>
    </NCard>
  </div>
</template>
