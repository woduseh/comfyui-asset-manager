import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModuleType } from '@shared/ipc-contract'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { createLatestRequest } from '@renderer/utils/latest-request'

export interface PromptModule {
  id: string
  name: string
  type: ModuleType
  description: string
  is_template: number
  parent_id: string | null
  created_at: string
  updated_at: string
}

export interface ModuleItem {
  id: string
  module_id: string
  name: string
  prompt: string
  negative: string
  weight: number
  sort_order: number
  metadata: string
  enabled: number
  prompt_variants: Record<string, { prompt: string; negative: string }>
}

export const useModuleStore = defineStore('module', () => {
  const modules = ref<PromptModule[]>([])
  const currentItems = ref<ModuleItem[]>([])
  const loading = ref(false)
  const currentModuleId = ref<string | null>(null)
  const moduleRequests = createLatestRequest({
    read: (type: string | undefined) =>
      invokeIpc(IPC_CHANNELS.MODULE_LIST, type ? { type } : undefined),
    commit: (result) => {
      modules.value = (result || []) as PromptModule[]
    },
    loading: (value) => {
      loading.value = value
    },
    error: () => {}
  })
  const itemRequests = createLatestRequest({
    read: (moduleId: string) => invokeIpc(IPC_CHANNELS.MODULE_ITEM_LIST, { moduleId }),
    commit: (result, moduleId) => {
      if (moduleId === currentModuleId.value) currentItems.value = result as ModuleItem[]
    },
    loading: () => {},
    error: () => {}
  })

  function loadModules(type?: string): Promise<void> {
    return moduleRequests.request(type)
  }

  async function createModule(data: {
    name: string
    type: string
    description?: string
    parent_id?: string
  }): Promise<string> {
    const id = await invokeIpc(IPC_CHANNELS.MODULE_CREATE, data)
    await loadModules()
    return id
  }

  async function updateModule(id: string, data: Partial<Record<string, unknown>>): Promise<void> {
    await invokeIpc(IPC_CHANNELS.MODULE_UPDATE, { id, data })
    await loadModules()
  }

  async function deleteModule(id: string): Promise<void> {
    await invokeIpc(IPC_CHANNELS.MODULE_DELETE, { id })
    modules.value = modules.value.filter((m) => m.id !== id)
  }

  function selectModule(id: string | null): void {
    currentModuleId.value = id
    itemRequests.cancel()
    currentItems.value = []
  }

  function loadItems(moduleId: string): Promise<void> {
    if (moduleId !== currentModuleId.value) return Promise.resolve()
    return itemRequests.request(moduleId)
  }

  async function createItem(data: {
    module_id: string
    name: string
    prompt: string
    negative?: string
    weight?: number
    sort_order?: number
    prompt_variants?: Record<string, { prompt: string; negative: string }>
  }): Promise<string> {
    const payload = {
      ...data,
      prompt_variants: data.prompt_variants ? JSON.stringify(data.prompt_variants) : '{}'
    }
    const id = await invokeIpc(IPC_CHANNELS.MODULE_ITEM_CREATE, payload)
    await loadItems(data.module_id)
    return id
  }

  async function updateItem(
    id: string,
    moduleId: string,
    data: Partial<Record<string, unknown>>
  ): Promise<void> {
    await invokeIpc(IPC_CHANNELS.MODULE_ITEM_UPDATE, { id, data })
    await loadItems(moduleId)
  }

  async function deleteItem(id: string, moduleId: string): Promise<void> {
    await invokeIpc(IPC_CHANNELS.MODULE_ITEM_DELETE, { id })
    await loadItems(moduleId)
  }

  return {
    modules,
    currentItems,
    selectModule,
    loading,
    loadModules,
    createModule,
    updateModule,
    deleteModule,
    loadItems,
    createItem,
    updateItem,
    deleteItem
  }
})
