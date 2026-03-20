import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { QueueProgress } from '@renderer/types/ipc'

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
  const currentProgress = ref<QueueProgress | null>(null)
  const isProcessing = ref(false)

  const totalProgress = computed(() => {
    if (!activeJobs.value.length) return 0
    const total = activeJobs.value.reduce((sum, j) => sum + j.totalTasks, 0)
    const completed = activeJobs.value.reduce((sum, j) => sum + j.completedTasks, 0)
    return total > 0 ? Math.round((completed / total) * 100) : 0
  })

  async function loadActiveJobs(): Promise<void> {
    const running = await window.electron.ipcRenderer.invoke('batch:list', { status: 'running' })
    const queued = await window.electron.ipcRenderer.invoke('batch:list', { status: 'queued' })
    activeJobs.value = [...(running || []), ...(queued || [])].map((j: Record<string, unknown>) => ({
      id: j.id as string,
      name: j.name as string,
      status: j.status as string,
      totalTasks: j.total_tasks as number,
      completedTasks: j.completed_tasks as number,
      failedTasks: j.failed_tasks as number,
      startedAt: j.started_at as string | null
    }))
    isProcessing.value = activeJobs.value.some((j) => j.status === 'running')
  }

  function updateProgress(progress: QueueProgress): void {
    currentProgress.value = progress
  }

  function onTaskCompleted(data: { jobId: string; etaMs?: number; avgTaskDurationMs?: number }): void {
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
    isProcessing.value = activeJobs.value.some((j) => j.status === 'running')
  }

  return {
    activeJobs,
    currentProgress,
    isProcessing,
    totalProgress,
    loadActiveJobs,
    updateProgress,
    onTaskCompleted,
    onTaskFailed,
    onJobCompleted
  }
})
