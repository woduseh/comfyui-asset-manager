import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  BatchJobRecord,
  QueueTaskCompletedEvent,
  QueueTaskFailedEvent
} from '@shared/ipc-contract'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { invokeIpc } from '@renderer/utils/ipc'

export interface QueueJobInfo extends BatchJobRecord {
  etaMs?: number
  avgTaskDurationMs?: number
}

export const useQueueStore = defineStore('queue', () => {
  const jobs = ref<QueueJobInfo[]>([])
  const loading = ref(false)
  const activeJobs = computed(() =>
    jobs.value.filter((job) => job.status === 'running' || job.status === 'queued')
  )
  const isProcessing = computed(() => activeJobs.value.some((job) => job.status === 'running'))
  const totalProgress = computed(() => {
    const total = activeJobs.value.reduce((sum, job) => sum + job.total_tasks, 0)
    const completed = activeJobs.value.reduce((sum, job) => sum + job.completed_tasks, 0)
    return total > 0 ? Math.round((completed / total) * 100) : 0
  })

  let pendingLoad = false
  let loadPromise: Promise<void> | null = null

  async function drainJobRequests(): Promise<void> {
    try {
      while (pendingLoad) {
        pendingLoad = false
        try {
          const records = await invokeIpc(IPC_CHANNELS.BATCH_LIST)
          // A refresh or queue event after this read began requires a newer snapshot.
          if (pendingLoad) continue
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
        } catch (error) {
          if (!pendingLoad) throw error
        }
      }
    } finally {
      loading.value = false
      loadPromise = null
    }
  }

  function loadJobs(): Promise<void> {
    pendingLoad = true
    if (!loadPromise) {
      loading.value = true
      loadPromise = Promise.resolve().then(drainJobRequests)
    }
    return loadPromise
  }

  function onTaskCompleted(data: Extract<QueueTaskCompletedEvent, { jobId: string }>): void {
    if (loadPromise) pendingLoad = true
    const job = jobs.value.find((entry) => entry.id === data.jobId)
    if (job) {
      job.completed_tasks = data.completed
      job.total_tasks = data.total
      job.etaMs = data.etaMs
      job.avgTaskDurationMs = data.avgTaskDurationMs
    }
  }

  function onTaskFailed(data: Extract<QueueTaskFailedEvent, { jobId: string }>): void {
    if (loadPromise) pendingLoad = true
    const job = jobs.value.find((entry) => entry.id === data.jobId)
    if (job) {
      job.completed_tasks = data.completed
      job.failed_tasks = data.failed
      job.total_tasks = data.total
      job.etaMs = data.etaMs
    }
  }

  function onJobCompleted(jobId: string): void {
    if (loadPromise) pendingLoad = true
    const job = jobs.value.find((entry) => entry.id === jobId)
    if (job) {
      job.status = 'completed'
      delete job.etaMs
      delete job.avgTaskDurationMs
    }
  }

  return {
    jobs,
    loading,
    activeJobs,
    isProcessing,
    totalProgress,
    loadJobs,
    onTaskCompleted,
    onTaskFailed,
    onJobCompleted
  }
})
