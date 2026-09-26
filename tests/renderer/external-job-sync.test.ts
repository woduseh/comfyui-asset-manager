// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '@renderer/App.vue'
import { useQueueStore } from '@renderer/stores/queue.store'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { BatchJobSummary } from '@shared/ipc-contract'
import en from '@renderer/locales/en.json'

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (value: unknown) => void>()
}))
vi.mock('@renderer/utils/ipc', () => ({
  invokeIpc: boundary.invoke,
  onIpc: (channel: string, listener: (value: unknown) => void) => {
    boundary.listeners.set(channel, listener)
    return () => boundary.listeners.delete(channel)
  }
}))
let wrapper: VueWrapper | undefined
let jobs: BatchJobSummary[]
const job: BatchJobSummary = {
  id: 'external-job',
  name: 'Created by MCP',
  description: '',
  workflow_id: null,
  status: 'draft',
  total_tasks: 3,
  completed_tasks: 0,
  failed_tasks: 0,
  created_at: '',
  started_at: null,
  completed_at: null
}
beforeEach(() => {
  jobs = []
  boundary.listeners.clear()
  boundary.invoke.mockReset().mockImplementation(async (channel: string) => {
    if (channel === IPC_CHANNELS.BATCH_LIST)
      return { items: jobs.map((row) => ({ ...row })), total: jobs.length }
    if (channel === IPC_CHANNELS.SETTINGS_GET_ALL) return { language: 'en', theme: 'dark' }
    if (channel === IPC_CHANNELS.COMFYUI_CONNECT) return false
    throw new Error(`Unexpected IPC: ${channel}`)
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function openApp(): ReturnType<typeof useQueueStore> {
  const pinia = createPinia()
  wrapper = mount(App, {
    global: {
      plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: { AppLayout: true }
    }
  })
  return useQueueStore(pinia)
}

describe('external job invalidation', () => {
  it('discovers an MCP draft while idle, follows queue status, and removes listeners on unmount', async () => {
    const store = openApp()
    await flushPromises()
    await store.loadJobs()
    expect(store.jobs).toEqual([])
    jobs = [{ ...job }]
    boundary.listeners.get(IPC_CHANNELS.BATCH_CHANGED)!(null)
    await flushPromises()
    expect(store.jobs[0]).toMatchObject(job)
    jobs[0].status = 'running'
    boundary.listeners.get(IPC_CHANNELS.QUEUE_STATUS_CHANGED)!({
      isProcessing: true,
      isPaused: false,
      currentJobId: job.id
    })
    await flushPromises()
    expect(store.queueStatus.currentJobId).toBe(job.id)
    expect(store.activeJobs[0].id).toBe(job.id)
    wrapper!.unmount()
    wrapper = undefined
    expect(boundary.listeners.size).toBe(0)
  })

  it('keeps a newer queue event over an older poll and discovers unknown task IDs', async () => {
    const store = openApp()
    await flushPromises()
    let release!: (value: unknown) => void
    boundary.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const polling = store.loadQueueStatus()
    jobs = [{ ...job, status: 'paused' }]
    boundary.listeners.get(IPC_CHANNELS.QUEUE_STATUS_CHANGED)!({
      isProcessing: true,
      isPaused: true,
      currentJobId: job.id
    })
    release({ isProcessing: true, isPaused: false, currentJobId: job.id })
    await polling
    await flushPromises()
    expect(store.queueStatus.isPaused).toBe(true)
    jobs.push({ ...job, id: 'unknown', status: 'running', completed_tasks: 1 })
    boundary.listeners.get(IPC_CHANNELS.QUEUE_TASK_COMPLETED)!({
      jobId: 'unknown',
      taskId: 't',
      completed: 1,
      total: 3,
      etaMs: 10,
      avgTaskDurationMs: 5
    })
    await flushPromises()
    expect(store.jobs.find((row) => row.id === 'unknown')?.completed_tasks).toBe(1)
  })

  it('exposes failed invalidations and recovers on a subsequent event', async () => {
    const store = openApp()
    await flushPromises()
    boundary.invoke.mockRejectedValueOnce(new Error('read failed'))
    boundary.listeners.get(IPC_CHANNELS.BATCH_CHANGED)!(null)
    await flushPromises()
    expect(store.loadError).toBe('read failed')
    jobs = [{ ...job }]
    boundary.listeners.get(IPC_CHANNELS.BATCH_CHANGED)!(null)
    await flushPromises()
    expect(store.loadError).toBeNull()
    expect(store.jobs).toHaveLength(1)
  })
})
