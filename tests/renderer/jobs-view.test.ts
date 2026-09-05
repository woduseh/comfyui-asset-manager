// @vitest-environment happy-dom

import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchJobRecord } from '@shared/ipc-contract'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import JobsView from '@renderer/views/JobsView.vue'
import JobStatusBar from '@renderer/components/jobs/JobStatusBar.vue'
import BatchWizard from '@renderer/components/jobs/BatchWizard.vue'
import ProductionJobTable from '@renderer/components/jobs/ProductionJobTable.vue'
import { useConnectionStore } from '@renderer/stores/connection.store'
import en from '@renderer/locales/en.json'

const invokeIpc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))

function job(id: string, status: BatchJobRecord['status']): BatchJobRecord {
  return {
    id,
    name: id,
    description: null,
    status,
    config: '{}',
    workflow_id: null,
    total_tasks: 4,
    completed_tasks: 0,
    failed_tasks: 0,
    pipeline_config: null,
    created_at: '2026-09-01 00:00:00',
    started_at: status === 'draft' ? null : '2026-09-01 00:01:00',
    completed_at: null
  }
}

describe('production jobs view', () => {
  let jobs: BatchJobRecord[]
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    jobs = []
    invokeIpc.mockReset()
    invokeIpc.mockImplementation(
      async (channel: string, args?: { id?: string; status?: string }) => {
        if (channel === IPC_CHANNELS.BATCH_LIST) {
          return jobs
            .filter((entry) => !args?.status || entry.status === args.status)
            .map((entry) => ({ ...entry }))
        }
        if (channel === IPC_CHANNELS.QUEUE_STATUS) {
          const current = jobs.find(
            (entry) => entry.status === 'running' || entry.status === 'paused'
          )
          return {
            isProcessing: Boolean(current),
            isPaused: current?.status === 'paused',
            currentJobId: current?.id ?? null
          }
        }
        if (channel === IPC_CHANNELS.GALLERY_LIST) return { items: [], total: 0 }
        if (channel === IPC_CHANNELS.BATCH_START || channel === IPC_CHANNELS.BATCH_RESUME) {
          const current = jobs.find((entry) => entry.id === args?.id)!
          current.status = 'running'
          current.started_at ??= '2026-09-01 00:02:00'
          return { success: true }
        }
        if (channel === IPC_CHANNELS.BATCH_PAUSE) {
          jobs.find((entry) => entry.status === 'running')!.status = 'paused'
          return
        }
        if (channel === IPC_CHANNELS.BATCH_CANCEL) {
          jobs.find((entry) => entry.id === args?.id)!.status = 'cancelled'
          return
        }
        throw new Error(`Unexpected IPC call: ${channel}`)
      }
    )
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
  })

  async function openJobs(): Promise<VueWrapper> {
    const pinia = createPinia()
    useConnectionStore(pinia).setConnectionChanged(true)
    wrapper = mount(
      defineComponent({
        components: { JobsView, NMessageProvider },
        template: '<NMessageProvider><JobsView /></NMessageProvider>'
      }),
      {
        global: {
          plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
          stubs: {
            BatchWizard: true,
            RecentResultsPanel: true
          }
        }
      }
    )
    await flushPromises()
    return wrapper
  }

  it('refreshes a draft through start, pause, resume and cancel and stops polling after unmount', async () => {
    jobs = [job('draft-job', 'draft')]
    const view = await openJobs()
    expect(
      invokeIpc.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BATCH_LIST)
    ).toHaveLength(1)
    view.findComponent(ProductionJobTable).vm.$emit('start', 'draft-job')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(view.findComponent(JobStatusBar).props('job')).toMatchObject({
      id: 'draft-job',
      status: 'running'
    })
    expect(
      invokeIpc.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BATCH_LIST)
    ).toHaveLength(2)

    view.findComponent(JobStatusBar).vm.$emit('pause')
    await flushPromises()
    expect(view.findComponent(JobStatusBar).props('isPaused')).toBe(true)
    view.findComponent(JobStatusBar).vm.$emit('resume')
    await flushPromises()
    expect(view.findComponent(JobStatusBar).props('isPaused')).toBe(false)
    view.findComponent(JobStatusBar).vm.$emit('cancel')
    await flushPromises()
    expect(view.findComponent(JobStatusBar).exists()).toBe(false)
    await view.get('.n-collapse-item__header-main').trigger('click')
    await flushPromises()
    expect(view.findComponent(ProductionJobTable).props('jobs')).toEqual([
      expect.objectContaining({ id: 'draft-job', status: 'cancelled' })
    ])

    view.unmount()
    wrapper = undefined
    const calls = invokeIpc.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(invokeIpc).toHaveBeenCalledTimes(calls)
  })

  it('preserves paused recovery, queued ordering and uncertain output restrictions', async () => {
    jobs = [
      { ...job('paused-job', 'paused'), uncertain_tasks: 1 },
      job('draft-job', 'draft'),
      job('queued-job', 'queued'),
      job('history-job', 'completed')
    ]
    const view = await openJobs()
    const status = view.findComponent(JobStatusBar)
    expect(status.props('isPaused')).toBe(true)
    expect(status.props('job').uncertain_tasks).toBe(1)
    expect(status.text()).toContain(en.jobs.production.needsReviewHint)
    await view.get('.n-collapse-item__header-main').trigger('click')
    await flushPromises()
    const tables = view.findAllComponents(ProductionJobTable)
    expect(tables[0].props('jobs').map((entry) => entry.id)).toEqual(['draft-job', 'queued-job'])
    expect(tables[1].props('jobs').map((entry) => entry.id)).toEqual(['history-job'])
  })

  it('reloads the queue after the wizard saves a draft', async () => {
    const view = await openJobs()
    jobs = [job('saved-draft', 'draft')]
    view.findComponent(BatchWizard).vm.$emit('saved')
    await flushPromises()
    expect(view.findComponent(ProductionJobTable).props('jobs')).toEqual(jobs)
  })
})
