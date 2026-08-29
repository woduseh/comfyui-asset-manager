<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AddOutline, FlashOutline, TimeOutline } from '@vicons/ionicons5'
import { NButton, NCollapse, NCollapseItem, NIcon, useMessage } from 'naive-ui'
import PageShell from '@renderer/components/common/PageShell.vue'
import ActionableEmptyState from '@renderer/components/common/ActionableEmptyState.vue'
import BatchWizard from '@renderer/components/jobs/BatchWizard.vue'
import JobStatusBar from '@renderer/components/jobs/JobStatusBar.vue'
import ProductionJobTable from '@renderer/components/jobs/ProductionJobTable.vue'
import RecentResultsPanel from '@renderer/components/jobs/RecentResultsPanel.vue'
import type { BatchWizardMode } from '@renderer/components/jobs/types'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useGalleryStore, type GalleryImage } from '@renderer/stores/gallery.store'
import { useQueueStore } from '@renderer/stores/queue.store'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { JOBS_REFRESH_INTERVAL_MS, PRODUCTION_RECENT_RESULTS_LIMIT } from '@renderer/constants'
import { buildBatchStatusLabels } from '@renderer/utils/view-labels'

const { t } = useI18n()
const message = useMessage()
const connectionStore = useConnectionStore()
const galleryStore = useGalleryStore()
const queueStore = useQueueStore()
const batchJobs = ref<Record<string, unknown>[]>([])
const loadingJobs = ref(false)
const recentImages = ref<GalleryImage[]>([])
const loadingRecentImages = ref(false)
const recentImagesLoadError = ref(false)
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
let recentImagesRequestId = 0

const statusLabels = computed(() => buildBatchStatusLabels(t))
const runningJob = computed(
  () => batchJobs.value.find((job) => job.status === 'running' || job.status === 'paused') || null
)
const runningQueueJob = computed(() =>
  runningJob.value
    ? queueStore.activeJobs.find((job) => job.id === runningJob.value?.id) || null
    : null
)
const queuedJobs = computed(() =>
  batchJobs.value.filter((job) => job.status === 'draft' || job.status === 'queued')
)
const completedJobs = computed(() =>
  batchJobs.value.filter((job) =>
    ['completed', 'failed', 'cancelled'].includes(job.status as string)
  )
)
const runningJobEta = computed(() => {
  const etaMs = runningQueueJob.value?.etaMs
  if (!etaMs || etaMs <= 0) return null

  const totalSeconds = Math.ceil(etaMs / 1000)
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
  await Promise.all([loadBatchJobs(), loadQueueStatus()])
}

async function loadRecentImages(): Promise<void> {
  const requestId = ++recentImagesRequestId
  loadingRecentImages.value = true
  recentImagesLoadError.value = false

  const query = {
    page: 1,
    pageSize: PRODUCTION_RECENT_RESULTS_LIMIT,
    sortBy: 'created_at' as const,
    sortOrder: 'desc' as const
  }

  try {
    const activeJobId = runningJob.value?.id as string | undefined
    let result = await invokeIpc(IPC_CHANNELS.GALLERY_LIST, {
      ...query,
      ...(activeJobId ? { jobId: activeJobId } : {})
    })

    if (activeJobId && (!result || result.items.length === 0)) {
      result = await invokeIpc(IPC_CHANNELS.GALLERY_LIST, query)
    }

    if (requestId === recentImagesRequestId) {
      recentImages.value = (result?.items || []) as GalleryImage[]
    }
  } catch {
    if (requestId === recentImagesRequestId) {
      recentImagesLoadError.value = true
    }
  } finally {
    if (requestId === recentImagesRequestId) {
      loadingRecentImages.value = false
    }
  }
}

async function handleMoveJob(jobId: string, direction: 'up' | 'down'): Promise<void> {
  const orderedQueuedIds = queuedJobs.value.map((job) => job.id as string)
  const currentIndex = orderedQueuedIds.indexOf(jobId)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedQueuedIds.length) return

  const targetId = orderedQueuedIds[targetIndex]
  const nextJobs = [...batchJobs.value]
  const sourcePosition = nextJobs.findIndex((job) => job.id === jobId)
  const targetPosition = nextJobs.findIndex((job) => job.id === targetId)
  if (sourcePosition < 0 || targetPosition < 0) return
  const sourceJob = nextJobs[sourcePosition]
  nextJobs[sourcePosition] = nextJobs[targetPosition]
  nextJobs[targetPosition] = sourceJob

  try {
    await invokeIpc(IPC_CHANNELS.BATCH_REORDER, {
      jobIds: nextJobs.map((job) => job.id as string)
    })
    batchJobs.value = nextJobs
  } catch (error) {
    message.error(
      t('jobs.production.reorderFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
  }
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
  if (!runningJob.value) return
  await invokeIpc(IPC_CHANNELS.BATCH_RESUME, { id: runningJob.value.id as string })
  message.info(t('batch.msg.resumed'))
  await refreshJobs()
}

async function handleReconnect(): Promise<void> {
  const connected = await connectionStore.connectConfigured()
  if (connected) {
    message.success(t('jobs.production.reconnected'))
    await Promise.all([refreshJobs(), queueStore.loadActiveJobs()])
  }
}

async function handleCancel(): Promise<void> {
  if (!runningJob.value) return
  await invokeIpc(IPC_CHANNELS.BATCH_CANCEL, { id: runningJob.value.id as string })
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
  void Promise.all([refreshJobs(), queueStore.loadActiveJobs(), loadRecentImages()])
  refreshInterval = setInterval(async () => {
    if (queueStatus.value.isProcessing || runningJob.value) {
      await Promise.all([refreshJobs(), loadRecentImages()])
    }
  }, JOBS_REFRESH_INTERVAL_MS)
})

watch(
  () => runningJob.value?.id,
  () => void loadRecentImages()
)

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
    <header class="production-header">
      <div>
        <span class="section-eyebrow">{{ t('jobs.production.eyebrow') }}</span>
        <h1>{{ t('jobs.production.title') }}</h1>
        <p>{{ t('jobs.production.subtitle') }}</p>
      </div>
      <NButton type="primary" size="large" @click="openWizard('create')">
        <template #icon><NIcon :component="AddOutline" /></template>
        {{ t('jobs.production.newGeneration') }}
      </NButton>
    </header>

    <div class="production-workspace">
      <div class="production-main">
        <JobStatusBar
          v-if="runningJob"
          :job="runningJob"
          :is-paused="queueStatus.isPaused"
          :is-connected="connectionStore.isConnected"
          :eta="runningJobEta"
          :avg-task-duration-ms="runningQueueJob?.avgTaskDurationMs"
          @pause="handlePause"
          @resume="handleResume"
          @reconnect="handleReconnect"
          @cancel="handleCancel"
        />

        <section v-else class="production-empty-run">
          <ActionableEmptyState
            :title="t('jobs.production.noActiveRun')"
            :description="t('jobs.production.noActiveRunHint')"
            :action-label="t('jobs.production.newGeneration')"
            @action="openWizard('create')"
          >
            <template #icon><NIcon :component="FlashOutline" :size="28" /></template>
          </ActionableEmptyState>
        </section>

        <section class="production-section">
          <header class="production-section__header">
            <div>
              <span class="section-eyebrow">{{ t('jobs.production.upNext') }}</span>
              <h2>{{ t('jobs.production.queue') }}</h2>
            </div>
            <span class="production-section__count">
              {{ t('jobs.production.queueCount', { count: queuedJobs.length }) }}
            </span>
          </header>

          <ProductionJobTable
            v-if="queuedJobs.length > 0"
            :jobs="queuedJobs"
            :status-labels="statusLabels"
            :is-connected="connectionStore.isConnected"
            :is-processing="queueStatus.isProcessing"
            reorderable
            @start="handleStartJob"
            @rerun="handleRerunJob"
            @edit="(job) => openWizard('edit', job)"
            @clone="(job) => openWizard('clone', job)"
            @delete="handleDeleteJob"
            @move="handleMoveJob"
          />
          <div v-else class="production-section__empty">
            {{ loadingJobs ? t('common.loading') : t('jobs.production.queueEmpty') }}
          </div>
        </section>

        <NCollapse class="production-history">
          <NCollapseItem name="history">
            <template #header>
              <div class="production-history__title">
                <NIcon :component="TimeOutline" />
                <span>{{ t('jobs.production.completedHistory') }}</span>
                <span>{{ completedJobs.length }}</span>
              </div>
            </template>
            <ProductionJobTable
              v-if="completedJobs.length > 0"
              :jobs="completedJobs"
              :status-labels="statusLabels"
              :is-connected="connectionStore.isConnected"
              :is-processing="queueStatus.isProcessing"
              @start="handleStartJob"
              @rerun="handleRerunJob"
              @edit="(job) => openWizard('edit', job)"
              @clone="(job) => openWizard('clone', job)"
              @delete="handleDeleteJob"
            />
            <div v-else class="production-section__empty">
              {{ t('jobs.production.historyEmpty') }}
            </div>
          </NCollapseItem>
        </NCollapse>
      </div>

      <RecentResultsPanel
        :images="recentImages"
        :loading="loadingRecentImages"
        :load-error="recentImagesLoadError"
        @open-explorer="galleryStore.showInExplorer"
        @retry="loadRecentImages"
      />
    </div>

    <BatchWizard
      v-model:show="showWizard"
      :mode="wizardMode"
      :source-job="wizardSourceJob"
      @saved="loadBatchJobs"
    />
  </PageShell>
</template>

<style scoped>
.production-header {
  display: flex;
  min-height: 92px;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  padding: 14px 4px 22px;
}

.production-header h1 {
  margin: 3px 0 0;
  font-size: 28px;
  line-height: 1.2;
}

.production-header p {
  margin-top: 6px;
  color: var(--app-text-muted);
  font-size: 13px;
}

.production-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(330px, 0.82fr);
  min-height: calc(100vh - 180px);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-panel);
  overflow: hidden;
}

.production-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}

.production-empty-run {
  min-height: 254px;
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
}

.production-section {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  overflow: hidden;
}

.production-section__header {
  display: flex;
  min-height: 65px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 18px;
}

.production-section__header h2 {
  margin-top: 3px;
  font-size: 17px;
}

.production-section__count {
  color: var(--app-text-subtle);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.production-section :deep(.production-table) {
  padding: 0 18px 4px;
}

.production-section__empty {
  padding: 32px 20px;
  border-top: 1px solid var(--app-border-subtle);
  color: var(--app-text-subtle);
  font-size: 12px;
  text-align: center;
}

.production-history {
  padding: 2px 4px;
}

.production-history__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-muted);
  font-size: 12px;
  font-weight: 650;
}

.production-history__title span:last-child {
  color: var(--app-text-subtle);
  font-variant-numeric: tabular-nums;
}

.production-history :deep(.production-table) {
  padding: 0 8px;
}

@media (max-width: 1180px) {
  .production-workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .production-header {
    align-items: flex-start;
    flex-direction: column;
    padding-bottom: 16px;
  }

  .production-header .n-button {
    width: 100%;
  }

  .production-main {
    padding: 12px;
  }
}
</style>
