// @vitest-environment happy-dom
/* eslint-disable vue/one-component-per-file -- Each scenario mounts its own test host. */

import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NButton, NMessageProvider, NSelect, NCollapseItem } from 'naive-ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import BatchWizard from '@renderer/components/jobs/BatchWizard.vue'
import JobStatusBar from '@renderer/components/jobs/JobStatusBar.vue'
import ProductionJobTable from '@renderer/components/jobs/ProductionJobTable.vue'
import WizardStepWorkflow from '@renderer/components/jobs/WizardStepWorkflow.vue'
import WizardStepModules from '@renderer/components/jobs/WizardStepModules.vue'
import WizardStepConfirm from '@renderer/components/jobs/WizardStepConfirm.vue'
import ConfirmActionButton from '@renderer/components/common/ConfirmActionButton'
import OverflowActionMenu from '@renderer/components/common/OverflowActionMenu.vue'
import ko from '@renderer/locales/ko.json'
import en from '@renderer/locales/en.json'

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

describe('JobStatusBar', () => {
  it.each(['ko', 'en'])('explains an uncertain task and blocks resume in %s', async (locale) => {
    const messages = locale === 'ko' ? ko : en
    const wrapper = mount(JobStatusBar, {
      props: {
        job: { name: 'Uncertain', completed_tasks: 0, total_tasks: 1, uncertain_tasks: 1 },
        isPaused: true,
        isConnected: true,
        eta: null
      },
      global: { plugins: [createI18n({ legacy: false, locale, messages: { ko, en } })] }
    })
    expect(wrapper.text()).toContain(messages.jobs.production.needsReviewHint)
    const resume = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text() === messages.batch.actions.resume)!
    expect(resume.props('disabled')).toBe(true)
    await resume.trigger('click')
    expect(wrapper.emitted('resume')).toBeUndefined()
    wrapper.unmount()
  })
  it('emits pause and cancel controls for a running job', async () => {
    const wrapper = mount(JobStatusBar, {
      props: {
        job: { name: 'Running', completed_tasks: 1, total_tasks: 4 },
        isPaused: false,
        isConnected: true,
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
        isConnected: true,
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

  it('does not mark preparation stages complete before progress starts', () => {
    const wrapper = mount(JobStatusBar, {
      props: {
        job: { name: 'Starting', completed_tasks: 0, total_tasks: 4 },
        isPaused: false,
        isConnected: true,
        eta: null
      },
      global: { plugins: [createTestI18n()] }
    })

    expect(wrapper.findAll('.active-run__stage--complete')).toHaveLength(0)
    expect(wrapper.findAll('.active-run__stage--active')).toHaveLength(1)
  })

  it('marks a persisted run as interrupted and offers reconnection', async () => {
    const wrapper = mount(JobStatusBar, {
      props: {
        job: { name: 'Disconnected', completed_tasks: 1, total_tasks: 4 },
        isPaused: false,
        isConnected: false,
        eta: null
      },
      global: { plugins: [createTestI18n()] }
    })

    expect(wrapper.findAll('.active-run__stage--interrupted')).toHaveLength(1)
    const reconnectButton = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text().includes('production.reconnect'))
    await reconnectButton!.trigger('click')

    expect(wrapper.emitted('reconnect')).toHaveLength(1)
    expect(
      wrapper
        .findAllComponents(NButton)
        .find((button) => button.text().includes('pause'))
        ?.props('disabled')
    ).toBe(true)
  })
})

describe('ProductionJobTable', () => {
  it('keeps cancelled uncertain output visible and blocks rerun while preserving explicit clone', async () => {
    const job = { id: 'uncertain', name: 'Needs review', status: 'cancelled', uncertain_tasks: 1 }
    const wrapper = mount(ProductionJobTable, {
      props: { jobs: [job], statusLabels: {}, isConnected: true, isProcessing: false },
      global: { plugins: [createTestI18n()] }
    })
    expect(wrapper.get('[role="status"]').text()).toContain('jobs.production.needsReviewHint')
    const rerun = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text().includes('rerun'))!
    expect(rerun.props('disabled')).toBe(true)
    await rerun.trigger('click')
    expect(wrapper.emitted('rerun')).toBeUndefined()
    expect(
      wrapper
        .findComponent(OverflowActionMenu)
        .props('actions')
        .find((action) => action.key === 'delete')?.disabled
    ).toBe(true)
    wrapper.findComponent(OverflowActionMenu).vm.$emit('select', 'clone')
    expect(wrapper.emitted('clone')).toEqual([[job]])
    wrapper.unmount()
  })
  it('keeps the production queue actions wired to the existing job payload', async () => {
    const job = {
      id: 'job-queue-1',
      name: 'Portrait variants',
      status: 'draft',
      total_tasks: 12,
      completed_tasks: 0,
      failed_tasks: 0,
      created_at: '2026-08-12 10:00:00'
    }
    const wrapper = mount(ProductionJobTable, {
      props: {
        jobs: [job],
        statusLabels: { draft: 'Draft' },
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

    expect(wrapper.emitted('start')).toEqual([['job-queue-1']])
    expect(wrapper.emitted('edit')).toEqual([[job]])
    expect(wrapper.emitted('clone')).toEqual([[job]])
    expect(wrapper.emitted('delete')).toEqual([['job-queue-1']])
  })

  it('emits bounded queue move actions', async () => {
    const jobs = [
      { id: 'job-1', name: 'First', status: 'draft', total_tasks: 1, completed_tasks: 0 },
      { id: 'job-2', name: 'Second', status: 'draft', total_tasks: 1, completed_tasks: 0 }
    ]
    const wrapper = mount(ProductionJobTable, {
      props: {
        jobs,
        statusLabels: { draft: 'Draft' },
        isConnected: true,
        isProcessing: false,
        reorderable: true
      },
      global: { plugins: [createTestI18n()] }
    })

    const moveButtons = wrapper.findAll('.production-table__reorder .n-button')
    expect(moveButtons[0].attributes('disabled')).toBeDefined()
    expect(moveButtons[3].attributes('disabled')).toBeDefined()

    await moveButtons[1].trigger('click')
    await moveButtons[2].trigger('click')

    expect(wrapper.emitted('move')).toEqual([
      ['job-1', 'down'],
      ['job-2', 'up']
    ])
  })
})

describe('BatchWizard', () => {
  it.each(
    [
      IPC_CHANNELS.MODULE_LIST,
      IPC_CHANNELS.WORKFLOW_VARIABLES,
      IPC_CHANNELS.COMFYUI_MODELS,
      IPC_CHANNELS.MODULE_ITEM_LIST
    ].flatMap((pendingChannel) => [
      { pendingChannel, oldResponseFirst: true },
      { pendingChannel, oldResponseFirst: false }
    ])
  )(
    'ignores cancelled $pendingChannel initialization (old response first: $oldResponseFirst)',
    async ({ pendingChannel, oldResponseFirst }) => {
      const pending: Array<() => void> = []
      const defaultInvoke = invokeIpcMock.getMockImplementation()!
      invokeIpcMock.mockImplementation((channel: string, args: unknown) => {
        const result =
          channel === IPC_CHANNELS.WORKFLOW_VARIABLES
            ? [
                {
                  id: 'prompt',
                  node_id: '1',
                  field_name: 'text',
                  display_name: 'Prompt',
                  role: 'prompt_positive',
                  var_type: 'string',
                  default_val: ''
                }
              ]
            : defaultInvoke(channel, args)
        return channel === pendingChannel
          ? new Promise((resolve) => pending.push(() => resolve(result)))
          : Promise.resolve(result)
      })
      function job(name: string): Record<string, unknown> {
        return {
          id: name,
          name,
          config: JSON.stringify({
            workflowId: 'workflow-1',
            moduleSelections: [{ moduleId: 'module-1', selectedItemIds: ['item-1'] }],
            slotMappings: [{ nodeId: '1', fieldName: 'text', prefixText: name }]
          })
        }
      }
      const Host = defineComponent({
        components: { BatchWizard, NMessageProvider },
        props: { show: Boolean, sourceJob: Object },
        template:
          '<NMessageProvider><BatchWizard :show="show" mode="edit" :source-job="sourceJob" /></NMessageProvider>'
      })
      const wrapper = mount(Host, {
        props: { show: true, sourceJob: job('Old') },
        global: {
          plugins: [createPinia(), createTestI18n()],
          stubs: {
            NModal: { template: '<div><slot /><slot name="footer" /></div>' },
            NScrollbar: { template: '<div><slot /></div>' }
          }
        }
      })
      await flushPromises()
      await wrapper.setProps({ show: false })
      await wrapper.setProps({ sourceJob: job('Current') })
      await wrapper.setProps({ show: true })
      await flushPromises()
      expect(pending).toHaveLength(2)
      const wizard = wrapper.findComponent(BatchWizard)
      pending[oldResponseFirst ? 0 : 1]()
      await flushPromises()
      expect(
        wizard
          .findAllComponents(NButton)
          .find((button) => button.text().includes('wizard.submit'))!
          .props('disabled')
      ).toBe(oldResponseFirst)
      pending[oldResponseFirst ? 1 : 0]()
      await flushPromises()
      expect(wizard.findComponent(WizardStepWorkflow).props('batchName')).toBe('Current')
      expect(wizard.findComponent(WizardStepModules).props('slotMappings')).toEqual([
        expect.objectContaining({ prefixText: 'Current' })
      ])
      expect(wizard.findComponent(WizardStepModules).props('moduleSelections')).toHaveLength(1)
      wrapper.unmount()
    }
  )

  it('restores saved values after workflow loading and resets them when reopening the same workflow', async () => {
    let resolveVariables!: (value: unknown[]) => void
    const defaultInvoke = invokeIpcMock.getMockImplementation()!
    invokeIpcMock.mockImplementation((channel: string, args: unknown) => {
      if (channel === IPC_CHANNELS.WORKFLOW_VARIABLES) {
        return new Promise((resolve) => {
          resolveVariables = resolve
        })
      }
      return defaultInvoke(channel, args)
    })
    const variables = [
      {
        id: 'prompt',
        node_id: '1',
        field_name: 'text',
        display_name: 'Prompt',
        role: 'prompt_positive',
        var_type: 'string',
        default_val: 'default'
      },
      {
        id: 'steps',
        node_id: '2',
        field_name: 'steps',
        display_name: 'Steps',
        role: 'other',
        var_type: 'number',
        default_val: '20'
      }
    ]
    const sourceJob = {
      id: 'job-1',
      name: 'Saved',
      config: JSON.stringify({
        workflowId: 'workflow-1',
        fixedSeed: 0,
        slotMappings: [
          {
            nodeId: '1',
            fieldName: 'text',
            prefixText: 'resolved prefix',
            userPrefixText: 'original prefix',
            promptVariant: 'portrait'
          }
        ],
        variableOverrides: [{ nodeId: '2', fieldName: 'steps', value: '35' }]
      })
    }
    const Host = defineComponent({
      components: { BatchWizard, NMessageProvider },
      props: { show: Boolean, mode: { type: String, default: 'edit' } },
      setup: () => ({ sourceJob }),
      template:
        '<NMessageProvider><BatchWizard :show="show" :mode="mode" :source-job="sourceJob" /></NMessageProvider>'
    })
    const wrapper = mount(Host, {
      props: { show: true },
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
    expect(wizard.findComponent(WizardStepModules).props('slotMappings')).toEqual([])
    expect(
      wizard.findComponent(WizardStepWorkflow).find('input').attributes('disabled')
    ).toBeDefined()
    expect(
      wizard
        .findAllComponents(NButton)
        .find((button) => button.text().includes('wizard.submit'))!
        .props('disabled')
    ).toBe(true)
    resolveVariables(variables)
    await flushPromises()
    expect(wizard.findComponent(WizardStepModules).props('slotMappings')).toEqual([
      expect.objectContaining({ prefixText: 'original prefix', promptVariant: 'portrait' })
    ])
    expect(wizard.findComponent(WizardStepConfirm).props('variableOverrides')).toEqual([
      expect.objectContaining({ enabled: true, value: '35' })
    ])
    expect(wizard.findComponent(WizardStepWorkflow).props('fixedSeed')).toBe(0)
    expect(
      wizard.findComponent(WizardStepWorkflow).find('input').attributes('disabled')
    ).toBeUndefined()

    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true, mode: 'create' })
    await flushPromises()
    resolveVariables(variables)
    await flushPromises()
    expect(wizard.findComponent(WizardStepModules).props('slotMappings')).toEqual([
      expect.objectContaining({ prefixText: '', promptVariant: '' })
    ])
    expect(wizard.findComponent(WizardStepConfirm).props('variableOverrides')).toEqual([
      expect.objectContaining({ enabled: false, value: '20' })
    ])
    wrapper.unmount()
  })

  it('shows all editor sections, gates saving and submits the unchanged batch payload', async () => {
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
    function nextButton(): VueWrapper<InstanceType<typeof NButton>> {
      return wizard
        .findAllComponents(NButton)
        .find((button) => button.text().includes('wizard.submit'))!
    }

    expect(nextButton().props('disabled')).toBe(true)
    workflowStep.vm.$emit('update:batchName', 'Example batch')
    workflowStep.vm.$emit('update:selectedWorkflowId', 'workflow-1')
    await flushPromises()
    expect(nextButton().props('disabled')).toBe(true)
    expect(wizard.findComponent(WizardStepWorkflow).isVisible()).toBe(true)
    expect(wizard.findComponent(WizardStepModules).isVisible()).toBe(true)
    expect(wizard.findComponent(WizardStepConfirm).isVisible()).toBe(true)
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

  it('preserves configured slots when a role refresh fails and is retried', async () => {
    const defaultInvoke = invokeIpcMock.getMockImplementation()!
    let reads = 0
    const variables = [
      {
        id: 'prompt',
        node_id: '1',
        field_name: 'text',
        display_name: 'Prompt',
        role: 'prompt_positive',
        var_type: 'string',
        default_val: ''
      },
      {
        id: 'steps',
        node_id: '2',
        field_name: 'steps',
        display_name: 'Steps',
        role: 'custom',
        var_type: 'number',
        default_val: '20'
      }
    ]
    invokeIpcMock.mockImplementation((channel: string, args: unknown) => {
      if (channel === IPC_CHANNELS.WORKFLOW_VARIABLES) {
        reads++
        if (reads === 2) return Promise.reject(new Error('Temporary read failure'))
        return Promise.resolve(variables)
      }
      if (channel === IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_ROLE) return Promise.resolve(true)
      return defaultInvoke(channel, args)
    })
    const sourceJob = {
      id: 'saved',
      name: 'Configured',
      config: JSON.stringify({
        workflowId: 'workflow-1',
        moduleSelections: [{ moduleId: 'module-1', selectedItemIds: ['item-1'] }],
        slotMappings: [
          {
            nodeId: '1',
            fieldName: 'text',
            prefixText: 'preserve me',
            assignedModuleIds: ['module-1']
          }
        ],
        variableOverrides: [{ nodeId: '2', fieldName: 'steps', value: '35' }]
      })
    }
    const Host = defineComponent({
      components: { BatchWizard, NMessageProvider },
      setup: () => ({ sourceJob }),
      template:
        '<NMessageProvider><BatchWizard :show="true" mode="edit" :source-job="sourceJob" /></NMessageProvider>'
    })
    const wrapper = mount(Host, {
      global: {
        plugins: [createPinia(), createTestI18n()],
        stubs: {
          NModal: { template: '<div><slot /><slot name="footer" /></div>' },
          NScrollbar: { template: '<div><slot /></div>' },
          NCollapse: { template: '<div><slot /></div>' },
          NCollapseItem: { template: '<div><slot /></div>' }
        }
      }
    })
    await flushPromises()
    const wizard = wrapper.findComponent(BatchWizard)
    await wizard
      .findAllComponents(NCollapseItem)
      .find((item) => item.props('name') === 'roles')!
      .find('.n-collapse-item__header-main')
      .trigger('click')
    await flushPromises()
    const role = wizard
      .findAllComponents(NSelect)
      .find((select) =>
        select.props('options')?.some((option) => option.value === 'prompt_positive')
      )!
    role.vm.$emit('update:value', 'prompt_positive')
    await flushPromises()
    const submit = wizard
      .findAllComponents(NButton)
      .find((button) => button.text().includes('wizard.submitEdit'))!
    expect(submit.props('disabled')).toBe(true)
    expect(wizard.findComponent(WizardStepModules).props('slotMappings')[0].prefixText).toBe(
      'preserve me'
    )
    const retry = wizard
      .findAllComponents(NButton)
      .find((button) => button.text() === 'common.retry')!
    await retry.trigger('click')
    await flushPromises()
    expect(submit.props('disabled')).toBe(false)
    expect(wizard.findComponent(WizardStepModules).props('slotMappings')[0]).toMatchObject({
      prefixText: 'preserve me',
      assignedModuleIds: ['module-1']
    })
    expect(wizard.findComponent(WizardStepConfirm).props('variableOverrides')[0]).toMatchObject({
      enabled: true,
      value: '35'
    })
    let resolveSave!: (result: unknown) => void
    invokeIpcMock.mockImplementation((channel: string, args: unknown) =>
      channel === IPC_CHANNELS.BATCH_UPDATE_DRAFT
        ? new Promise((resolve) => {
            resolveSave = resolve
          })
        : defaultInvoke(channel, args)
    )
    await submit.trigger('click')
    await submit.trigger('click')
    expect(
      invokeIpcMock.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BATCH_UPDATE_DRAFT)
    ).toHaveLength(1)
    resolveSave({ jobId: 'saved', totalTasks: 1 })
    await flushPromises()
    wrapper.unmount()
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
