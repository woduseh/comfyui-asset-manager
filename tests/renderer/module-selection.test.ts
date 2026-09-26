// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import ModuleView from '@renderer/views/ModuleView.vue'
import ModuleBrowser from '@renderer/components/modules/ModuleBrowser.vue'
import { useModuleStore } from '@renderer/stores/module.store'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import en from '@renderer/locales/en.json'
const invokeIpc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))
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
      global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] }
    }
  )
  return { view: wrapper, store: useModuleStore(pinia) }
}

describe('selected module response ownership', () => {
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
