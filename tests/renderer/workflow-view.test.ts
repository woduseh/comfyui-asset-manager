// @vitest-environment happy-dom
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NButton, NDialogProvider, NDrawer, NInput, NMessageProvider, NSelect } from 'naive-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkflowView from '@renderer/views/WorkflowView.vue'
import { useWorkflowStore } from '@renderer/stores/workflow.store'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import en from '@renderer/locales/en.json'

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>()
}))
vi.mock('@renderer/utils/ipc', () => ({
  invokeIpc: boundary.invoke,
  onIpc: (channel: string, listener: (payload: unknown) => void) => {
    boundary.listeners.set(channel, listener)
    return () => boundary.listeners.delete(channel)
  }
}))
const original = {
  id: 'workflow',
  name: 'Original workflow',
  description: 'Original description',
  category: 'generation',
  variables: '[]',
  created_at: '',
  updated_at: ''
}
let workflow = { ...original }
let role = 'prompt_positive'
let wrapper: VueWrapper | undefined
beforeEach(() => {
  workflow = { ...original }
  role = 'prompt_positive'
  boundary.listeners.clear()
  boundary.invoke.mockReset().mockImplementation(async (channel: string) => {
    if (channel === IPC_CHANNELS.WORKFLOW_LIST) return [{ ...workflow }]
    if (channel === IPC_CHANNELS.WORKFLOW_GET) return { ...workflow }
    if (channel === IPC_CHANNELS.WORKFLOW_VARIABLES)
      return [
        {
          id: 'variable',
          display_name: 'Positive prompt',
          node_id: '1',
          field_name: 'text',
          var_type: 'text',
          default_val: 'test',
          role
        }
      ]
    throw new Error(`Unexpected IPC: ${channel}`)
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

async function openWorkflow(): Promise<VueWrapper> {
  wrapper = mount(
    defineComponent({
      components: { WorkflowView, NMessageProvider, NDialogProvider },
      template:
        '<NMessageProvider><NDialogProvider><WorkflowView /></NDialogProvider></NMessageProvider>'
    }),
    {
      global: {
        plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en } })],
        stubs: { teleport: true }
      }
    }
  )
  await flushPromises()
  wrapper
    .findAllComponents(NButton)
    .find((button) => button.text() === en.common.detail)!
    .vm.$emit('click')
  await flushPromises()
  return wrapper
}

describe('workflow external invalidation', () => {
  it('refreshes list and variable roles without overwriting unsaved metadata', async () => {
    const view = await openWorkflow()
    const name = view.findAllComponents(NInput)[0]
    const description = view.findAllComponents(NInput)[1]
    name.vm.$emit('update:value', 'Unsaved name')
    description.vm.$emit('update:value', 'Unsaved description')
    await flushPromises()
    workflow = { ...workflow, name: 'External name', description: 'External description' }
    role = 'prompt_negative'
    boundary.listeners.get(IPC_CHANNELS.DATA_CHANGED)!({ scopes: ['workflows'] })
    await flushPromises()
    expect(useWorkflowStore().workflows[0].name).toBe('External name')
    expect(name.props('value')).toBe('Unsaved name')
    expect(description.props('value')).toBe('Unsaved description')
    expect(
      view.findAllComponents(NSelect).some((select) => select.props('value') === 'prompt_negative')
    ).toBe(true)
    expect(view.findComponent(NDrawer).props('show')).toBe(true)
    view.unmount()
    wrapper = undefined
    expect(boundary.listeners.size).toBe(0)
  })

  it('adopts external metadata when the detail has no local changes', async () => {
    const view = await openWorkflow()
    workflow = { ...workflow, name: 'External name', description: 'External description' }
    boundary.listeners.get(IPC_CHANNELS.DATA_CHANGED)!({ scopes: ['workflows'] })
    await flushPromises()
    expect(view.findAllComponents(NInput)[0].props('value')).toBe('External name')
    expect(view.findAllComponents(NInput)[1].props('value')).toBe('External description')
    expect(
      view
        .findAllComponents(NButton)
        .find((button) => button.text() === en.common.save)!
        .props('disabled')
    ).toBe(true)
  })

  it('does not reopen a detail closed while external refresh is in flight', async () => {
    const view = await openWorkflow()
    const fallback = boundary.invoke.getMockImplementation()!
    let release!: (value: unknown) => void
    boundary.invoke.mockImplementation((channel: string, args: unknown) => {
      if (channel === IPC_CHANNELS.WORKFLOW_GET)
        return new Promise((resolve) => {
          release = resolve
        })
      return fallback(channel, args)
    })
    boundary.listeners.get(IPC_CHANNELS.DATA_CHANGED)!({ scopes: ['workflows'] })
    await flushPromises()
    view
      .findAllComponents(NButton)
      .find((button) => button.text() === en.common.close)!
      .vm.$emit('click')
    release({ ...workflow, name: 'Late response' })
    await flushPromises()
    expect(view.findComponent(NDrawer).props('show')).toBe(false)
    const detailReads = boundary.invoke.mock.calls.filter(
      ([channel]) => channel === IPC_CHANNELS.WORKFLOW_GET
    ).length
    boundary.listeners.get(IPC_CHANNELS.DATA_CHANGED)!({ scopes: ['workflows'] })
    await flushPromises()
    expect(
      boundary.invoke.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.WORKFLOW_GET)
    ).toHaveLength(detailReads)
    expect(view.findComponent(NDrawer).props('show')).toBe(false)
  })
})
