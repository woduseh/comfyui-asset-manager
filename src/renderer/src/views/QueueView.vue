<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NEmpty, NProgress, NSpace, NText, NButton, NTag,
  NStatistic, NGrid, NGridItem, NDivider, NDataTable, useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import { useQueueStore } from '@renderer/stores/queue.store'
import { useConnectionStore } from '@renderer/stores/connection.store'

const { t } = useI18n()
const message = useMessage()
const queueStore = useQueueStore()
const connectionStore = useConnectionStore()

const queueStatus = ref<{ isProcessing: boolean; isPaused: boolean; currentJobId: string | null }>({
  isProcessing: false,
  isPaused: false,
  currentJobId: null
})

// All batch jobs for display
const allJobs = ref<Record<string, unknown>[]>([])
const loadingJobs = ref(false)
let refreshInterval: ReturnType<typeof setInterval> | null = null

const jobColumns: DataTableColumns = [
  { title: t('common.name'), key: 'name', width: 180 },
  {
    title: t('common.status'),
    key: 'status',
    width: 100,
    render(row) {
      const colors: Record<string, string> = {
        draft: 'default', queued: 'info', running: 'warning',
        paused: 'default', completed: 'success', failed: 'error', cancelled: 'default'
      }
      return h(NTag, { type: (colors[row.status as string] || 'default') as 'success' | 'info' | 'warning' | 'error' | 'default', size: 'small' }, {
        default: () => t(`batch.status.${row.status}`)
      })
    }
  },
  {
    title: '진행',
    key: 'progress',
    width: 200,
    render(row) {
      const total = (row.total_tasks as number) || 0
      const completed = (row.completed_tasks as number) || 0
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0
      return h(NSpace, { align: 'center' }, {
        default: () => [
          h(NProgress, { type: 'line', percentage: pct, style: 'width: 120px;', showIndicator: false }, {}),
          h('span', { style: 'font-size: 12px;' }, `${completed}/${total}`)
        ]
      })
    }
  },
  {
    title: '실패',
    key: 'failed_tasks',
    width: 60,
    render(row) {
      const failed = (row.failed_tasks as number) || 0
      return failed > 0 ? h(NTag, { type: 'error', size: 'tiny' }, { default: () => String(failed) }) : '-'
    }
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 220,
    render(row) {
      const status = row.status as string
      const buttons: ReturnType<typeof h>[] = []

      if (status === 'draft' || status === 'queued') {
        buttons.push(h(NButton, {
          size: 'tiny', type: 'primary',
          disabled: !connectionStore.isConnected,
          onClick: () => handleStartJob(row.id as string)
        }, { default: () => t('batch.actions.start') }))
      }
      if (status === 'running') {
        buttons.push(h(NButton, { size: 'tiny', type: 'warning', onClick: () => handlePause() }, {
          default: () => t('batch.actions.pause')
        }))
        buttons.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => handleCancel() }, {
          default: () => t('batch.actions.cancel')
        }))
      }
      if (status === 'paused') {
        buttons.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => handleResume() }, {
          default: () => t('batch.actions.resume')
        }))
        buttons.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => handleCancel() }, {
          default: () => t('batch.actions.cancel')
        }))
      }

      return h(NSpace, { size: 'small' }, { default: () => buttons })
    }
  }
]

async function loadAllJobs(): Promise<void> {
  loadingJobs.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('batch:list')
    allJobs.value = result || []
  } finally {
    loadingJobs.value = false
  }
}

async function loadQueueStatus(): Promise<void> {
  try {
    queueStatus.value = await window.electron.ipcRenderer.invoke('queue:status')
  } catch { /* ignore */ }
}

async function handleStartJob(jobId: string): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('batch:start', { id: jobId })
  if (result.success) {
    message.success('배치 작업이 시작되었습니다')
  } else {
    message.error('시작 실패: ' + result.error)
  }
  await loadAllJobs()
}

async function handlePause(): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:pause')
  message.info('일시정지됨')
  await loadAllJobs()
  await loadQueueStatus()
}

async function handleResume(): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:resume')
  message.info('재개됨')
  await loadAllJobs()
  await loadQueueStatus()
}

async function handleCancel(): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:cancel')
  message.warning('취소됨')
  await loadAllJobs()
  await loadQueueStatus()
}

onMounted(() => {
  loadAllJobs()
  loadQueueStatus()
  queueStore.loadActiveJobs()
  // Auto-refresh every 3 seconds when processing
  refreshInterval = setInterval(async () => {
    if (queueStatus.value.isProcessing) {
      await loadAllJobs()
      await loadQueueStatus()
    }
  }, 3000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>

<template>
  <div class="queue-view">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>{{ t('queue.title') }}</h2>
      <NSpace>
        <NTag :type="queueStatus.isProcessing ? 'warning' : 'default'" size="small">
          {{ queueStatus.isProcessing ? (queueStatus.isPaused ? '일시정지' : '실행 중') : '대기' }}
        </NTag>
        <NButton size="small" @click="loadAllJobs">새로고침</NButton>
      </NSpace>
    </div>

    <!-- Active processing summary -->
    <template v-if="queueStore.activeJobs.length > 0">
      <NCard style="margin-top: 16px;" title="현재 실행 중">
        <NGrid :cols="4" :x-gap="16">
          <NGridItem>
            <NStatistic label="전체 진행률" :value="queueStore.totalProgress + '%'" />
          </NGridItem>
          <NGridItem v-for="job in queueStore.activeJobs" :key="job.id">
            <NStatistic :label="job.name" :value="`${job.completedTasks}/${job.totalTasks}`" />
            <NProgress
              type="line"
              :percentage="job.totalTasks > 0 ? Math.round((job.completedTasks / job.totalTasks) * 100) : 0"
              :status="job.status === 'running' ? 'info' : 'default'"
              style="margin-top: 4px;"
            />
          </NGridItem>
        </NGrid>
      </NCard>
    </template>

    <NDivider />

    <!-- All jobs table -->
    <NCard title="배치 작업 목록">
      <NDataTable
        v-if="allJobs.length > 0"
        :columns="jobColumns"
        :data="allJobs"
        :loading="loadingJobs"
        :row-key="(row: Record<string, unknown>) => row.id as string"
      />
      <NEmpty v-else :description="t('queue.empty')" />
    </NCard>
  </div>
</template>
