import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { invokeIpc } from '@renderer/utils/ipc'

export interface QueueJobInfo {
  id: string
  name: string
  status: string
  totalTasks: number
  completedTasks: number
  failedTasks: number
  startedAt: string | null
  etaMs?: number
  avgTaskDurationMs?: number
}

export const useQueueStore = defineStore('queue', () => {
  const activeJobs = ref<QueueJobInfo[]>([])
  const isProcessing = computed(() => activeJobs.value.some((job) => job.status === 'running'))

  const totalProgress = computed(() => {
    if (!activeJobs.value.length) return 0
    const total = activeJobs.value.reduce((sum, j) => sum + j.totalTasks, 0)
    const completed = activeJobs.value.reduce((sum, j) => sum + j.completedTasks, 0)
    return total > 0 ? Math.round((completed / total) * 100) : 0
  })

  async function loadActiveJobs(): Promise<void> {
    const [running, queued] = await Promise.all([
      invokeIpc(IPC_CHANNELS.BATCH_LIST, { status: 'running' }),
      invokeIpc(IPC_CHANNELS.BATCH_LIST, { status: 'queued' })
    ])
    activeJobs.value = [...(running || []), ...(queued || [])].map(
      (j: Record<string, unknown>) => ({
        id: j.id as string,
        name: j.name as string,
        status: j.status as string,
        totalTasks: j.total_tasks as number,
        completedTasks: j.completed_tasks as number,
        failedTasks: j.failed_tasks as number,
        startedAt: j.started_at as string | null
      })
    )
  }

  function onTaskCompleted(data: {
    jobId: string
    etaMs?: number
    avgTaskDurationMs?: number
  }): void {
    const job = activeJobs.value.find((j) => j.id === data.jobId)
    if (job) {
      job.completedTasks++
      job.etaMs = data.etaMs
      job.avgTaskDurationMs = data.avgTaskDurationMs
    }
  }

  function onTaskFailed(data: { jobId: string; etaMs?: number }): void {
    const job = activeJobs.value.find((j) => j.id === data.jobId)
    if (job) {
      job.failedTasks++
      job.etaMs = data.etaMs
    }
  }

  function onJobCompleted(jobId: string): void {
    const idx = activeJobs.value.findIndex((j) => j.id === jobId)
    if (idx !== -1) {
      activeJobs.value.splice(idx, 1)
    }
  }

  return {
    activeJobs,
    isProcessing,
    totalProgress,
    loadActiveJobs,
    onTaskCompleted,
    onTaskFailed,
    onJobCompleted
  }
})
