<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, useMessage } from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import PageShell from '@renderer/components/common/PageShell.vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import ActionableEmptyState from '@renderer/components/common/ActionableEmptyState.vue'
import BatchWizard from '@renderer/components/jobs/BatchWizard.vue'
import JobCard from '@renderer/components/jobs/JobCard.vue'
import JobStatusBar from '@renderer/components/jobs/JobStatusBar.vue'
import type { BatchWizardMode } from '@renderer/components/jobs/types'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useQueueStore } from '@renderer/stores/queue.store'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { JOBS_REFRESH_INTERVAL_MS } from '@renderer/constants'
import { buildBatchStatusLabels } from '@renderer/utils/view-labels'

const { t } = useI18n()
const message = useMessage()
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()
const batchJobs = ref<Record<string, unknown>[]>([])
const loadingJobs = ref(false)
const queueStatus = ref<{ isProcessing: boolean; isPaused: boolean; currentJobId: string | null }>({
  isProcessing: false,
  isPaused: false,
  currentJobId: null
})
const showWizard = ref(false)
const wizardMode = ref<BatchWizardMode>('create')
const wizardSourceJob = ref<Record<string, unknown> | null>(null)
let refreshInterval: ReturnType<typeof setInterval> | null = null
let jobRefreshTimer: ReturnType<typeof setTimeout> | null = null

const statusLabels = computed(() => buildBatchStatusLabels(t))
const runningJob = computed(
  () => batchJobs.value.find((job) => job.status === 'running' || job.status === 'paused') || null
)
const runningJobEta = computed(() => {
  if (!runningJob.value) return null
  const queueJob = queueStore.activeJobs.find((job) => job.id === runningJob.value?.id)
  if (!queueJob?.etaMs || queueJob.etaMs <= 0) return null

  const totalSeconds = Math.ceil(queueJob.etaMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return t('jobs.time.hours', { hours, mins: minutes })
  if (minutes > 0) return t('jobs.time.minutes', { mins: minutes, secs: seconds })
  return t('jobs.time.seconds', { secs: seconds })
})

async function loadBatchJobs(): Promise<void> {
  loadingJobs.value = true
  try {
    batchJobs.value = (await invokeIpc(IPC_CHANNELS.BATCH_LIST)) || []
  } finally {
    loadingJobs.value = false
  }
}

async function loadQueueStatus(): Promise<void> {
  try {
    queueStatus.value = await invokeIpc(IPC_CHANNELS.QUEUE_STATUS)
  } catch (error) {
    void error
    // Queue polling is best-effort; preserve the latest known state.
  }
}

async function refreshJobs(): Promise<void> {
  await loadBatchJobs()
  await loadQueueStatus()
}

async function handleReorderJobs(): Promise<void> {
  await invokeIpc(IPC_CHANNELS.BATCH_REORDER, {
    jobIds: batchJobs.value.map((job) => job.id as string)
  })
}

async function handleStartJob(jobId: string): Promise<void> {
  const result = await invokeIpc(IPC_CHANNELS.BATCH_START, { id: jobId })
  if (!result.success) {
    message.error(t('batch.msg.startFailed', { error: result.error }))
    return
  }
  message.success(t('batch.msg.started'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  await refreshJobs()
  await queueStore.loadActiveJobs()
}

async function handlePause(): Promise<void> {
  await invokeIpc(IPC_CHANNELS.BATCH_PAUSE)
  message.info(t('batch.msg.paused'))
  await refreshJobs()
}

async function handleResume(): Promise<void> {
  await invokeIpc(IPC_CHANNELS.BATCH_RESUME)
  message.info(t('batch.msg.resumed'))
  await refreshJobs()
}

async function handleCancel(): Promise<void> {
  await invokeIpc(IPC_CHANNELS.BATCH_CANCEL)
  message.warning(t('batch.msg.cancelled'))
  await refreshJobs()
}

async function handleDeleteJob(jobId: string): Promise<void> {
  await invokeIpc(IPC_CHANNELS.BATCH_DELETE, { id: jobId })
  await loadBatchJobs()
  message.success(t('batch.msg.deleted'))
}

async function handleRerunJob(job: Record<string, unknown>): Promise<void> {
  try {
    const result = await invokeIpc(IPC_CHANNELS.BATCH_RERUN, { id: job.id as string })
    if (!result.success) {
      message.error(t('batch.msg.rerunFailed', { error: result.error }))
      return
    }
    message.success(t('batch.msg.rerunStartedShort'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    await refreshJobs()
    await queueStore.loadActiveJobs()
  } catch (error) {
    message.error(
      t('batch.msg.rerunFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

function openWizard(mode: BatchWizardMode, job: Record<string, unknown> | null = null): void {
  wizardMode.value = mode
  wizardSourceJob.value = job
  showWizard.value = true
}

onMounted(() => {
  void refreshJobs()
  refreshInterval = setInterval(async () => {
    if (queueStatus.value.isProcessing || runningJob.value) await refreshJobs()
  }, JOBS_REFRESH_INTERVAL_MS)
})

watch(
  () => queueStore.activeJobs.length,
  () => {
    if (jobRefreshTimer) clearTimeout(jobRefreshTimer)
    jobRefreshTimer = setTimeout(() => void refreshJobs(), 1000)
  }
)

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  if (jobRefreshTimer) clearTimeout(jobRefreshTimer)
})
</script>

<template>
  <PageShell>
    <PageHeader :title="t('jobs.title')" :description="t('jobs.pageDescription')">
      <template #actions>
        <NButton type="primary" @click="openWizard('create')">{{ t('jobs.newBatch') }}</NButton>
      </template>
    </PageHeader>

    <JobStatusBar
      v-if="runningJob"
      :job="runningJob"
      :is-paused="queueStatus.isPaused"
      :eta="runningJobEta"
      @pause="handlePause"
      @resume="handleResume"
      @cancel="handleCancel"
    />

    <VueDraggable
      v-if="batchJobs.length > 0"
      v-model="batchJobs"
      :animation="200"
      handle=".job-drag-handle"
      class="jobs-grid"
      @end="handleReorderJobs"
    >
      <JobCard
        v-for="job in batchJobs"
        :key="job.id as string"
        :job="job"
        :status-label="statusLabels[job.status as string] || (job.status as string)"
        :is-connected="connectionStore.isConnected"
        :is-processing="queueStatus.isProcessing"
        @start="handleStartJob(job.id as string)"
        @rerun="handleRerunJob(job)"
        @edit="openWizard('edit', job)"
        @clone="openWizard('clone', job)"
        @delete="handleDeleteJob(job.id as string)"
      />
    </VueDraggable>
    <NCard v-else>
      <ActionableEmptyState
        :title="t('jobs.emptyHint')"
        :description="t('jobs.emptyDescription')"
        :action-label="t('jobs.newBatch')"
        @action="openWizard('create')"
      />
    </NCard>

    <BatchWizard
      v-model:show="showWizard"
      :mode="wizardMode"
      :source-job="wizardSourceJob"
      @saved="loadBatchJobs"
    />
  </PageShell>
</template>

<style scoped>
.jobs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}

@media (max-width: 720px) {
  .jobs-grid {
    grid-template-columns: 1fr;
  }
}
</style>
