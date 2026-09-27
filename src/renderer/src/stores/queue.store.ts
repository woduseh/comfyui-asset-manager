import { createLatestRequest } from '@renderer/utils/latest-request'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  BatchJobSummary,
  QueueStatus,
  QueueTaskCompletedEvent,
  QueueTaskFailedEvent
} from '@shared/ipc-contract'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { invokeIpc } from '@renderer/utils/ipc'

export interface QueueJobInfo extends BatchJobSummary {
  etaMs?: number
  avgTaskDurationMs?: number
}

export const useQueueStore = defineStore('queue', () => {
  const jobs = ref<QueueJobInfo[]>([])
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const queueStatus = ref<QueueStatus>({ isProcessing: false, isPaused: false, currentJobId: null })
  let statusRevision = 0

  async function loadQueueStatus(): Promise<void> {
    const revision = ++statusRevision
    const status = await invokeIpc(IPC_CHANNELS.QUEUE_STATUS)
    if (revision === statusRevision) queueStatus.value = status
  }

  function onStatusChanged(status: QueueStatus): void {
    statusRevision++
    queueStatus.value = status
    refreshFromEvent()
  }

  function refreshFromEvent(): void {
    // Errors are retained for the jobs view, not left as unhandled event rejections.
    void loadJobs().catch(() => {})
  }

  const activeJobs = computed(() =>
    jobs.value.filter((job) => job.status === 'running' || job.status === 'queued')
  )
  const isProcessing = computed(() => activeJobs.value.some((job) => job.status === 'running'))
  const totalProgress = computed(() => {
    const total = activeJobs.value.reduce((sum, job) => sum + job.total_tasks, 0)
    const completed = activeJobs.value.reduce((sum, job) => sum + job.completed_tasks, 0)
    return total > 0 ? Math.round((completed / total) * 100) : 0
  })

  const requests = createLatestRequest({
    read: () => invokeIpc(IPC_CHANNELS.BATCH_LIST, { scope: 'current' }),
    commit: ({ items: records }) => {
      loadError.value = null
      const previousJobs = new Map(jobs.value.map((job) => [job.id, job]))
      jobs.value = records.map((job) => {
        const previous = previousJobs.get(job.id)
        if (
          previous &&
          job.started_at !== null &&
          job.started_at === previous.started_at &&
          job.completed_tasks >= previous.completed_tasks &&
          job.failed_tasks >= previous.failed_tasks &&
          (job.status === 'running' || job.status === 'paused')
        ) {
          return {
            ...job,
            etaMs: previous.etaMs,
            avgTaskDurationMs: previous.avgTaskDurationMs
          }
        }
        return job
      })
    },
    loading: (value) => {
      loading.value = value
    },
    error: (error) => {
      loadError.value = error instanceof Error ? error.message : String(error)
    }
  })

  function loadJobs(): Promise<void> {
    return requests.request(null)
  }

  function onTaskCompleted(data: QueueTaskCompletedEvent): void {
    requests.refreshIfRunning()
    const job = jobs.value.find((entry) => entry.id === data.jobId)
    if (!job) refreshFromEvent()
    if (job) {
      job.completed_tasks = data.completed
      job.total_tasks = data.total
      job.etaMs = data.etaMs
      job.avgTaskDurationMs = data.avgTaskDurationMs
    }
  }

  function onTaskFailed(data: QueueTaskFailedEvent): void {
    requests.refreshIfRunning()
    const job = jobs.value.find((entry) => entry.id === data.jobId)
    if (!job) refreshFromEvent()
    if (job) {
      job.completed_tasks = data.completed
      job.failed_tasks = data.failed
      job.total_tasks = data.total
      job.etaMs = data.etaMs
    }
  }

  function onJobCompleted(jobId: string): void {
    requests.refreshIfRunning()
    const job = jobs.value.find((entry) => entry.id === jobId)
    if (!job) refreshFromEvent()
    if (job) {
      job.status = 'completed'
      delete job.etaMs
      delete job.avgTaskDurationMs
    }
  }

  return {
    jobs,
    loading,
    loadError,
    queueStatus,
    loadQueueStatus,
    onStatusChanged,
    refreshFromEvent,
    activeJobs,
    isProcessing,
    totalProgress,
    loadJobs,
    onTaskCompleted,
    onTaskFailed,
    onJobCompleted
  }
})
