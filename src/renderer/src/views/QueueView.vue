<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NEmpty, NProgress, NSpace, NText } from 'naive-ui'
import { useQueueStore } from '@renderer/stores/queue.store'

const { t } = useI18n()
const queueStore = useQueueStore()

onMounted(() => {
  queueStore.loadActiveJobs()
})
</script>

<template>
  <div class="queue-view">
    <h2>{{ t('queue.title') }}</h2>

    <NCard style="margin-top: 16px;">
      <template v-if="queueStore.activeJobs.length > 0">
        <NSpace vertical>
          <NCard v-for="job in queueStore.activeJobs" :key="job.id" :title="job.name" size="small">
            <NSpace vertical>
              <NText>{{ t('queue.progress') }}: {{ job.completedTasks }} / {{ job.totalTasks }}</NText>
              <NProgress
                type="line"
                :percentage="job.totalTasks > 0 ? Math.round((job.completedTasks / job.totalTasks) * 100) : 0"
                :status="job.status === 'running' ? 'info' : 'default'"
              />
            </NSpace>
          </NCard>
        </NSpace>
      </template>
      <NEmpty v-else :description="t('queue.empty')" />
    </NCard>
  </div>
</template>
