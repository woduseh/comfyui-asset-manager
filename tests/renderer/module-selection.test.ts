// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NButton, NInput, NMessageProvider } from 'naive-ui'
import ModuleView from '@renderer/views/ModuleView.vue'
import ModuleBrowser from '@renderer/components/modules/ModuleBrowser.vue'
import { useModuleStore } from '@renderer/stores/module.store'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import en from '@renderer/locales/en.json'
const { invokeIpc, listeners } = vi.hoisted(() => ({
  invokeIpc: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>()
}))
vi.mock('@renderer/utils/ipc', () => ({
  invokeIpc,
  onIpc: (channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener)
    return () => listeners.delete(channel)
  }
}))
const modA = {
  id: 'a',
  name: 'Module A',
  type: 'custom',
  description: '',
  is_template: 0,
  parent_id: null,
  created_at: '',
  updated_at: ''
}
const modB = { ...modA, id: 'b', name: 'Module B' }
const itemA = {
  id: 'a-item',
  module_id: 'a',
  name: 'A item',
  prompt: 'A',
  negative: '',
  weight: 1,
  sort_order: 0,
  metadata: '{}',
  enabled: 1,
  prompt_variants: {}
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  invokeIpc.mockReset()
  listeners.clear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})
function openView(): { view: VueWrapper; store: ReturnType<typeof useModuleStore> } {
  const pinia = createPinia()
  wrapper = mount(
    defineComponent({
      components: { ModuleView, NMessageProvider },
      template: '<NMessageProvider><ModuleView /></NMessageProvider>'
    }),
    {
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        stubs: { teleport: true }
      }
    }
  )
  return { view: wrapper, store: useModuleStore(pinia) }
}

describe('selected module response ownership', () => {
  it('refreshes external module/item changes while preserving an open item draft', async () => {
    let currentModule = modA
    let currentItem = itemA
    invokeIpc.mockImplementation(async (channel: string) => {
      if (channel === IPC_CHANNELS.MODULE_LIST) return [{ ...currentModule }]
      if (channel === IPC_CHANNELS.MODULE_GET) return { ...currentModule }
      if (channel === IPC_CHANNELS.MODULE_ITEM_LIST) return [{ ...currentItem }]
      if (channel === IPC_CHANNELS.PROMPT_PREVIEW)
        return { positive: currentItem.prompt, negative: '' }
      throw new Error(`Unexpected IPC: ${channel}`)
    })
    const { view, store } = openView()
    await flushPromises()
    view.findComponent(ModuleBrowser).vm.$emit('select', 'a')
    await flushPromises()
    view
      .findAllComponents(NButton)
      .find((button) => button.text() === en.module.addItem)!
      .vm.$emit('click')
    await flushPromises()
    const draft = view
      .findAllComponents(NInput)
      .find((input) => input.props('placeholder') === en.module.item.namePlaceholder)!
    draft.vm.$emit('update:value', 'Unsaved item')
    currentModule = { ...modA, name: 'Renamed externally' }
    currentItem = { ...itemA, prompt: 'External prompt' }
    listeners.get(IPC_CHANNELS.DATA_CHANGED)!({ scopes: ['modules'] })
    await flushPromises()
    expect(store.modules[0].name).toBe('Renamed externally')
    expect(view.get('.module-detail').text()).toContain('Renamed externally')
    expect(store.currentItems[0].prompt).toBe('External prompt')
    expect(draft.props('value')).toBe('Unsaved item')
    view.unmount()
    wrapper = undefined
    expect(listeners.size).toBe(0)
  })

  it('discards a selected-module response captured before an external invalidation', async () => {
    let release!: (value: unknown) => void
    let read = 0
    invokeIpc.mockImplementation((channel: string) => {
      if (channel === IPC_CHANNELS.MODULE_LIST) return Promise.resolve([modA])
      if (channel === IPC_CHANNELS.MODULE_GET) {
        if (++read === 1)
          return new Promise((resolve) => {
            release = resolve
          })
        return Promise.resolve({ ...modA, name: 'Newest module' })
      }
      if (channel === IPC_CHANNELS.MODULE_ITEM_LIST) return Promise.resolve([itemA])
      if (channel === IPC_CHANNELS.PROMPT_PREVIEW)
        return Promise.resolve({ positive: '', negative: '' })
      throw new Error(`Unexpected IPC: ${channel}`)
    })
    const { view } = openView()
    await flushPromises()
    view.findComponent(ModuleBrowser).vm.$emit('select', 'a')
    await flushPromises()
    listeners.get(IPC_CHANNELS.DATA_CHANGED)!({ scopes: ['modules'] })
    release({ ...modA, name: 'Stale module' })
    await flushPromises()
    expect(view.get('.module-detail').text()).toContain('Newest module')
    expect(view.get('.module-detail').text()).not.toContain('Stale module')
  })
  it('discards metadata from a deselected module and never displays it under a newer selection', async () => {
    let releaseA!: (value: unknown) => void
    let releaseB!: (value: unknown) => void
    invokeIpc.mockImplementation((channel: string, args?: { id?: string; moduleId?: string }) => {
      if (channel === IPC_CHANNELS.MODULE_LIST) return Promise.resolve([modA, modB])
      if (channel === IPC_CHANNELS.MODULE_GET)
        return new Promise((resolve) => {
          if (args?.id === 'a') releaseA = resolve
          else releaseB = resolve
        })
      if (channel === IPC_CHANNELS.MODULE_ITEM_LIST) return Promise.resolve([])
      if (channel === IPC_CHANNELS.PROMPT_PREVIEW)
        return Promise.resolve({ positive: '', negative: '' })
      throw new Error(`Unexpected IPC: ${channel}`)
    })
    const { view, store } = openView()
    await flushPromises()
    view.findComponent(ModuleBrowser).vm.$emit('select', 'a')
    await flushPromises()
    view.findComponent(ModuleBrowser).vm.$emit('select', 'a')
    await flushPromises()
    releaseA(modA)
    await flushPromises()
    expect(store.currentItems).toEqual([])
    view.findComponent(ModuleBrowser).vm.$emit('select', 'b')
    await flushPromises()
    expect(view.find('.module-detail').exists()).toBe(false)
    releaseB(modB)
    await flushPromises()
    expect(view.get('.module-detail').text()).toContain('Module B')
    expect(
      invokeIpc.mock.calls.filter(
        ([channel, args]) => channel === IPC_CHANNELS.MODULE_ITEM_LIST && args.moduleId === 'a'
      )
    ).toEqual([])
  })

  it.each(['switch', 'unmount'] as const)(
    'discards in-flight item responses on %s',
    async (action) => {
      let release!: (value: unknown) => void
      invokeIpc.mockImplementation((channel: string, args?: { id?: string; moduleId?: string }) => {
        if (channel === IPC_CHANNELS.MODULE_LIST) return Promise.resolve([modA, modB])
        if (channel === IPC_CHANNELS.MODULE_GET)
          return Promise.resolve(args?.id === 'a' ? modA : modB)
        if (channel === IPC_CHANNELS.MODULE_ITEM_LIST)
          return args?.moduleId === 'a'
            ? new Promise((resolve) => {
                release = resolve
              })
            : Promise.resolve([])
        if (channel === IPC_CHANNELS.PROMPT_PREVIEW)
          return Promise.resolve({ positive: 'preview', negative: '' })
        throw new Error(`Unexpected IPC: ${channel}`)
      })
      const { view, store } = openView()
      await flushPromises()
      view.findComponent(ModuleBrowser).vm.$emit('select', 'a')
      await flushPromises()
      if (action === 'switch') {
        view.findComponent(ModuleBrowser).vm.$emit('select', 'b')
        await flushPromises()
      } else {
        view.unmount()
        wrapper = undefined
      }
      release([itemA])
      await flushPromises()
      expect(store.currentItems).toEqual([])
      if (action === 'switch') expect(view.get('.module-detail').text()).toContain('Module B')
    }
  )
})
