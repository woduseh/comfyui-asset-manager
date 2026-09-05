// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import { NSelect } from 'naive-ui'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import WizardStepModules from '@renderer/components/jobs/WizardStepModules.vue'
import { useModuleStore, type ModuleItem } from '@renderer/stores/module.store'

const invokeIpc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))

describe('wizard module selection', () => {
  it('keeps simultaneous module results separate without replacing the module editor items', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const moduleStore = useModuleStore()
    const editorItem = { id: 'editor-item' } as ModuleItem
    moduleStore.currentItems = [editorItem]
    const pending = new Map<string, (items: ModuleItem[]) => void>()
    invokeIpc.mockImplementation((channel: string, args: { moduleId: string }) => {
      expect(channel).toBe(IPC_CHANNELS.MODULE_ITEM_LIST)
      return new Promise<ModuleItem[]>((resolve) => pending.set(args.moduleId, resolve))
    })
    const wrapper = mount(WizardStepModules, {
      props: {
        availableModules: ['first', 'second'].map((id) => ({
          id,
          name: id,
          type: 'custom' as const,
          description: '',
          is_template: 0,
          parent_id: null,
          created_at: '',
          updated_at: ''
        })),
        moduleSelections: [],
        moduleToAdd: null,
        slotMappings: []
      },
      global: {
        plugins: [
          pinia,
          createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })
        ]
      }
    })
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'first')
    select.vm.$emit('update:value', 'second')
    const firstItems = [
      { id: 'first-enabled', enabled: 1 },
      { id: 'first-disabled', enabled: 0 }
    ] as ModuleItem[]
    const secondItems = [{ id: 'second-enabled', enabled: 1 }] as ModuleItem[]
    pending.get('first')!(firstItems)
    pending.get('second')!(secondItems)
    await flushPromises()

    expect(wrapper.props('moduleSelections')).toEqual([
      expect.objectContaining({
        moduleId: 'first',
        items: firstItems,
        selectedItemIds: ['first-enabled']
      }),
      expect.objectContaining({
        moduleId: 'second',
        items: secondItems,
        selectedItemIds: ['second-enabled']
      })
    ])
    expect(moduleStore.currentItems).toEqual([editorItem])
    wrapper.unmount()
  })
})
