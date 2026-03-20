import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModuleType } from '@renderer/types/ipc'
import { toPlain } from '@renderer/utils/ipc'

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
  const currentModule = ref<PromptModule | null>(null)
  const currentItems = ref<ModuleItem[]>([])
  const loading = ref(false)

  async function loadModules(type?: string): Promise<void> {
    loading.value = true
    try {
      const result = await window.electron.ipcRenderer.invoke('module:list', type ? { type } : undefined)
      modules.value = (result || []) as PromptModule[]
    } finally {
      loading.value = false
    }
  }

  async function getModule(id: string): Promise<PromptModule | null> {
    const result = await window.electron.ipcRenderer.invoke('module:get', { id })
    currentModule.value = result as PromptModule
    return currentModule.value
  }

  async function createModule(data: { name: string; type: string; description?: string; parent_id?: string }): Promise<string> {
    const id = await window.electron.ipcRenderer.invoke('module:create', toPlain(data))
    await loadModules()
    return id
  }

  async function updateModule(id: string, data: Partial<Record<string, unknown>>): Promise<void> {
    await window.electron.ipcRenderer.invoke('module:update', { id, data: toPlain(data) })
    await loadModules()
  }

  async function deleteModule(id: string): Promise<void> {
    await window.electron.ipcRenderer.invoke('module:delete', { id })
    modules.value = modules.value.filter((m) => m.id !== id)
  }

  async function loadItems(moduleId: string): Promise<void> {
    const result = await window.electron.ipcRenderer.invoke('module-item:list', { moduleId })
    currentItems.value = (result || []) as ModuleItem[]
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
    const id = await window.electron.ipcRenderer.invoke('module-item:create', toPlain(payload))
    await loadItems(data.module_id)
    return id
  }

  async function updateItem(id: string, moduleId: string, data: Partial<Record<string, unknown>>): Promise<void> {
    await window.electron.ipcRenderer.invoke('module-item:update', { id, data: toPlain(data) })
    await loadItems(moduleId)
  }

  async function deleteItem(id: string, moduleId: string): Promise<void> {
    await window.electron.ipcRenderer.invoke('module-item:delete', { id })
    await loadItems(moduleId)
  }

  return {
    modules,
    currentModule,
    currentItems,
    loading,
    loadModules,
    getModule,
    createModule,
    updateModule,
    deleteModule,
    loadItems,
    createItem,
    updateItem,
    deleteItem
  }
})
