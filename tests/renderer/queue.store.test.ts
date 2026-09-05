import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BatchJobRecord, QueueTaskCompletedEvent } from '@shared/ipc-contract'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { useQueueStore } from '@renderer/stores/queue.store'

const invokeIpc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))

function job(id = 'running', status: BatchJobRecord['status'] = 'running'): BatchJobRecord {
  return {
    id,
    name: id,
    description: null,
    status,
    config: '{}',
    workflow_id: null,
    total_tasks: 10,
    completed_tasks: 1,
    failed_tasks: 0,
    pipeline_config: null,
    created_at: '2026-09-01 00:00:00',
    started_at: '2026-09-01 00:01:00',
    completed_at: null
  }
}

function completedEvent(): Extract<QueueTaskCompletedEvent, { jobId: string }> {
  return {
    jobId: 'running',
    taskId: 'task-2',
    completed: 2,
    total: 10,
    etaMs: 80_000,
    avgTaskDurationMs: 10_000
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('queue store snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeIpc.mockReset()
  })

  it('loads every job once and derives the active queue without losing recovery or history fields', async () => {
    const records = [
      job(),
      job('queued', 'queued'),
      { ...job('paused', 'paused'), uncertain_tasks: 1 },
      job('completed', 'completed'),
      job('draft', 'draft')
    ]
    invokeIpc.mockResolvedValue(records)
    const store = useQueueStore()
    await store.loadJobs()

    expect(invokeIpc.mock.calls).toEqual([[IPC_CHANNELS.BATCH_LIST]])
    expect(store.jobs).toEqual(records)
    expect(store.activeJobs.map((entry) => entry.id)).toEqual(['running', 'queued'])
    expect(store.isProcessing).toBe(true)
    expect(store.totalProgress).toBe(10)
  })

  it('applies authoritative event counts once and moves a completed job into history', async () => {
    invokeIpc.mockResolvedValue([job()])
    const store = useQueueStore()
    await store.loadJobs()
    store.onTaskCompleted(completedEvent())
    store.onTaskCompleted(completedEvent())
    expect(store.jobs[0].completed_tasks).toBe(2)
    expect(store.totalProgress).toBe(20)
    store.onTaskFailed({
      jobId: 'running',
      taskId: 'failed-task',
      error: 'failure',
      completed: 2,
      failed: 1,
      total: 10,
      etaMs: 70_000
    })
    expect(store.jobs[0]).toMatchObject({ completed_tasks: 2, failed_tasks: 1, etaMs: 70_000 })
    store.onJobCompleted('running')
    expect(store.jobs[0].status).toBe('completed')
    expect(store.jobs[0].etaMs).toBeUndefined()
    expect(store.jobs[0].avgTaskDurationMs).toBeUndefined()
    expect(store.activeJobs).toEqual([])
    expect(store.isProcessing).toBe(false)
    expect(store.totalProgress).toBe(0)
  })

  it.each([
    { startedAt: '2026-09-01 00:01:00', completed: 0 },
    { startedAt: '2026-09-02 00:01:00', completed: 2 }
  ])(
    'retains timing while paused and clears it after rerun with $startedAt/$completed',
    async ({ startedAt, completed }) => {
      invokeIpc.mockResolvedValueOnce([job()])
      const store = useQueueStore()
      await store.loadJobs()
      store.onTaskCompleted(completedEvent())
      invokeIpc.mockResolvedValueOnce([{ ...job('running', 'paused'), completed_tasks: 2 }])
      await store.loadJobs()
      expect(store.jobs[0]).toMatchObject({ etaMs: 80_000, avgTaskDurationMs: 10_000 })
      invokeIpc.mockResolvedValueOnce([
        { ...job(), started_at: startedAt, completed_tasks: completed }
      ])
      await store.loadJobs()
      expect(store.jobs[0].completed_tasks).toBe(completed)
      expect(store.jobs[0].etaMs).toBeUndefined()
      expect(store.jobs[0].avgTaskDurationMs).toBeUndefined()
    }
  )

  it('coalesces refreshes during a read into one fresh snapshot', async () => {
    const first = deferred<BatchJobRecord[]>()
    const latest = deferred<BatchJobRecord[]>()
    invokeIpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    const store = useQueueStore()
    const initial = store.loadJobs()
    await Promise.resolve()
    const refreshes = Array.from({ length: 20 }, () => store.loadJobs())
    first.resolve([job('obsolete')])
    await Promise.resolve()
    expect(invokeIpc).toHaveBeenCalledTimes(2)
    expect(store.jobs).toEqual([])
    expect(store.loading).toBe(true)
    latest.resolve([job('latest')])
    await Promise.all([initial, ...refreshes])
    expect(store.jobs[0].id).toBe('latest')
    expect(store.loading).toBe(false)
  })

  it.each(['completed-task', 'failed-task', 'completed-job'] as const)(
    'does not overwrite a %s event with a snapshot requested before it',
    async (event) => {
      const original = job()
      invokeIpc.mockResolvedValueOnce([original])
      const store = useQueueStore()
      await store.loadJobs()
      const stale = deferred<BatchJobRecord[]>()
      const latest = deferred<BatchJobRecord[]>()
      invokeIpc.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise)
      const loading = store.loadJobs()
      await Promise.resolve()
      if (event === 'completed-task') store.onTaskCompleted(completedEvent())
      if (event === 'failed-task') {
        store.onTaskFailed({
          jobId: 'running',
          taskId: 'failed',
          error: 'failure',
          completed: 1,
          failed: 1,
          total: 10
        })
      }
      if (event === 'completed-job') store.onJobCompleted('running')
      const afterEvent = { ...store.jobs[0] }
      stale.resolve([job()])
      await Promise.resolve()
      expect(store.jobs[0]).toEqual(afterEvent)
      expect(invokeIpc).toHaveBeenCalledTimes(3)
      latest.resolve([afterEvent])
      await loading
      expect(store.jobs[0]).toEqual(afterEvent)
    }
  )

  it('preserves visible jobs on a current failure and allows retry', async () => {
    invokeIpc.mockResolvedValueOnce([job()])
    const store = useQueueStore()
    await store.loadJobs()
    invokeIpc.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(store.loadJobs()).rejects.toThrow('database unavailable')
    expect(store.jobs[0].id).toBe('running')
    expect(store.loading).toBe(false)
    invokeIpc.mockResolvedValueOnce([])
    await store.loadJobs()
    expect(store.jobs).toEqual([])
  })

  it('finishes the requested refresh when an obsolete read fails', async () => {
    const obsolete = deferred<BatchJobRecord[]>()
    invokeIpc.mockReturnValueOnce(obsolete.promise).mockResolvedValueOnce([job('latest')])
    const store = useQueueStore()
    const initial = store.loadJobs()
    await Promise.resolve()
    const refresh = store.loadJobs()
    obsolete.reject(new Error('obsolete failure'))
    await Promise.all([initial, refresh])
    expect(store.jobs[0].id).toBe('latest')
    expect(store.loading).toBe(false)
  })
})
