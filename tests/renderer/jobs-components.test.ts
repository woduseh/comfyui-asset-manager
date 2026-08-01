// @vitest-environment happy-dom

import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NButton, NMessageProvider } from 'naive-ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import BatchWizard from '@renderer/components/jobs/BatchWizard.vue'
import JobCard from '@renderer/components/jobs/JobCard.vue'
import JobStatusBar from '@renderer/components/jobs/JobStatusBar.vue'
import WizardStepWorkflow from '@renderer/components/jobs/WizardStepWorkflow.vue'
import WizardStepModules from '@renderer/components/jobs/WizardStepModules.vue'
import ConfirmActionButton from '@renderer/components/common/ConfirmActionButton'
import OverflowActionMenu from '@renderer/components/common/OverflowActionMenu.vue'

const invokeIpcMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/utils/ipc', () => ({
  invokeIpc: invokeIpcMock
}))

function createTestI18n(): ReturnType<typeof createI18n> {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: {} }
  })
}

beforeEach(() => {
  invokeIpcMock.mockReset()
  invokeIpcMock.mockImplementation((channel: string) => {
    if (channel === IPC_CHANNELS.MODULE_LIST) {
      return Promise.resolve([
        { id: 'module-1', name: 'Characters', type: 'character', description: '' }
      ])
    }
    if (channel === IPC_CHANNELS.MODULE_ITEM_LIST) {
      return Promise.resolve([
        {
          id: 'item-1',
          module_id: 'module-1',
          name: 'Alice',
          prompt: 'alice',
          negative: '',
          weight: 1,
          sort_order: 0,
          enabled: 1,
          prompt_variants: {}
        }
      ])
    }
    if (channel === IPC_CHANNELS.WORKFLOW_LIST) {
      return Promise.resolve([
        {
          id: 'workflow-1',
          name: 'Workflow',
          description: '',
          category: 'generation',
          variables: '[]',
          created_at: '',
          updated_at: ''
        }
      ])
    }
    if (channel === IPC_CHANNELS.WORKFLOW_VARIABLES) return Promise.resolve([])
    if (channel === IPC_CHANNELS.COMFYUI_MODELS) {
      return Promise.resolve({
        checkpoints: [],
        loras: [],
        vaes: [],
        upscaleModels: [],
        samplers: [],
        schedulers: []
      })
    }
    if (channel === IPC_CHANNELS.BATCH_CREATE) {
      return Promise.resolve({ jobId: 'job-1', totalTasks: 1 })
    }
    if (channel === IPC_CHANNELS.BATCH_UPDATE_DRAFT) {
      return Promise.resolve({ jobId: 'job-1', totalTasks: 1 })
    }
    if (channel === IPC_CHANNELS.SETTINGS_GET_ALL) return Promise.resolve({})
    return Promise.resolve(undefined)
  })
})

describe('JobCard', () => {
  it('emits primary and overflow actions without changing job data', async () => {
    const job = {
      id: 'job-1',
      name: 'Example',
      status: 'draft',
      total_tasks: 2,
      completed_tasks: 0,
      failed_tasks: 0
    }
    const wrapper = mount(JobCard, {
      props: {
        job,
        statusLabel: 'Draft',
        isConnected: true,
        isProcessing: false
      },
      global: { plugins: [createTestI18n()] }
    })

    const startButton = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text().includes('start'))
    await startButton!.trigger('click')
    wrapper.findComponent(OverflowActionMenu).vm.$emit('select', 'edit')
    wrapper.findComponent(OverflowActionMenu).vm.$emit('select', 'clone')
    wrapper.findComponent(OverflowActionMenu).vm.$emit('select', 'delete')

    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('clone')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(job.status).toBe('draft')
  })

  it('offers in-place editing only for draft jobs', () => {
    const wrapper = mount(JobCard, {
      props: {
        job: {
          id: 'job-1',
          name: 'Completed',
          status: 'completed',
          total_tasks: 1,
          completed_tasks: 1,
          failed_tasks: 0
        },
        statusLabel: 'Completed',
        isConnected: true,
        isProcessing: false
      },
      global: { plugins: [createTestI18n()] }
    })

    const actions = wrapper.findComponent(OverflowActionMenu).props('actions') as Array<{
      key: string
    }>
    expect(actions.map((action) => action.key)).toEqual(['clone', 'delete'])
  })
})

describe('JobStatusBar', () => {
  it('emits pause and cancel controls for a running job', async () => {
    const wrapper = mount(JobStatusBar, {
      props: {
        job: { name: 'Running', completed_tasks: 1, total_tasks: 4 },
        isPaused: false,
        eta: '3s'
      },
      global: { plugins: [createTestI18n()] }
    })

    const pauseButton = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text().includes('pause'))
    await pauseButton!.trigger('click')
    wrapper.findComponent(ConfirmActionButton).vm.$emit('confirm')

    expect(wrapper.emitted('pause')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('emits resume for a paused job', async () => {
    const wrapper = mount(JobStatusBar, {
      props: {
        job: { name: 'Paused', completed_tasks: 1, total_tasks: 4 },
        isPaused: true,
        eta: null
      },
      global: { plugins: [createTestI18n()] }
    })

    const resumeButton = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text().includes('resume'))
    await resumeButton!.trigger('click')

    expect(wrapper.emitted('resume')).toHaveLength(1)
  })
})

describe('BatchWizard', () => {
  it('gates navigation and emits the unchanged batch payload after submit', async () => {
    const Host = defineComponent({
      components: { BatchWizard, NMessageProvider },
      template: `
        <NMessageProvider>
          <BatchWizard :show="true" mode="create" :source-job="null" />
        </NMessageProvider>
      `
    })
    const wrapper = mount(Host, {
      global: {
        plugins: [createPinia(), createTestI18n()],
        stubs: {
          NModal: {
            template: '<div><slot /><slot name="footer" /></div>'
          },
          NScrollbar: {
            template: '<div><slot /></div>'
          }
        }
      }
    })
    await flushPromises()

    const wizard = wrapper.findComponent(BatchWizard)
    const workflowStep = wizard.findComponent(WizardStepWorkflow)
    function nextButton(): VueWrapper {
      return wizard
        .findAllComponents(NButton)
        .find((button) => button.text().includes('wizard.next')) as VueWrapper
    }

    expect(nextButton().props('disabled')).toBe(true)
    workflowStep.vm.$emit('update:batchName', 'Example batch')
    workflowStep.vm.$emit('update:selectedWorkflowId', 'workflow-1')
    await flushPromises()
    expect(nextButton().props('disabled')).toBe(false)

    await nextButton().trigger('click')
    const moduleStep = wizard.findComponent(WizardStepModules)
    moduleStep.vm.$emit('update:moduleSelections', [
      {
        moduleId: 'module-1',
        moduleName: 'Characters',
        moduleType: 'character',
        items: [],
        selectedItemIds: ['item-1']
      }
    ])
    await flushPromises()
    expect(nextButton().props('disabled')).toBe(false)

    await nextButton().trigger('click')
    const submitButton = wizard
      .findAllComponents(NButton)
      .find((button) => button.text().includes('wizard.submitCreate'))!
    await submitButton.trigger('click')
    await flushPromises()

    expect(invokeIpcMock).toHaveBeenCalledWith(
      IPC_CHANNELS.BATCH_CREATE,
      expect.objectContaining({
        name: 'Example batch',
        workflowId: 'workflow-1',
        moduleSelections: [
          {
            moduleId: 'module-1',
            moduleType: 'character',
            selectedItemIds: ['item-1']
          }
        ],
        countPerCombination: 1,
        seedMode: 'random',
        fixedSeed: 42
      })
    )
    expect(wizard.emitted('saved')).toHaveLength(1)
  })

  it('updates an existing draft without deleting it first', async () => {
    const sourceJob = {
      id: 'job-1',
      name: 'Existing batch',
      status: 'draft',
      config: JSON.stringify({
        workflowId: 'workflow-1',
        moduleSelections: [
          {
            moduleId: 'module-1',
            moduleType: 'character',
            selectedItemIds: ['item-1']
          }
        ],
        countPerCombination: 1,
        seedMode: 'random',
        fixedSeed: 42,
        outputFolderPattern: '{job}',
        fileNamePattern: '{index}'
      })
    }
    const Host = defineComponent({
      components: { BatchWizard, NMessageProvider },
      setup: () => ({ sourceJob }),
      template: `
        <NMessageProvider>
          <BatchWizard :show="true" mode="edit" :source-job="sourceJob" />
        </NMessageProvider>
      `
    })
    const wrapper = mount(Host, {
      global: {
        plugins: [createPinia(), createTestI18n()],
        stubs: {
          NModal: { template: '<div><slot /><slot name="footer" /></div>' },
          NScrollbar: { template: '<div><slot /></div>' }
        }
      }
    })
    await flushPromises()

    const wizard = wrapper.findComponent(BatchWizard)
    function nextButton(): VueWrapper {
      return wizard
        .findAllComponents(NButton)
        .find((button) => button.text().includes('wizard.next')) as VueWrapper
    }
    await nextButton().trigger('click')
    await nextButton().trigger('click')
    const submitButton = wizard
      .findAllComponents(NButton)
      .find((button) => button.text().includes('wizard.submitEdit'))!
    await submitButton.trigger('click')
    await flushPromises()

    expect(invokeIpcMock).toHaveBeenCalledWith(
      IPC_CHANNELS.BATCH_UPDATE_DRAFT,
      expect.objectContaining({
        id: 'job-1',
        config: expect.objectContaining({ name: 'Existing batch' })
      })
    )
    expect(invokeIpcMock).not.toHaveBeenCalledWith(IPC_CHANNELS.BATCH_DELETE, expect.anything())
    expect(invokeIpcMock).not.toHaveBeenCalledWith(
      IPC_CHANNELS.BATCH_DELETE_TASKS,
      expect.anything()
    )
  })
})
