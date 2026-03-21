import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toPlain } from '@renderer/utils/ipc'

export interface WorkflowItem {
  id: string
  name: string
  description: string
  category: string
  variables: string
  created_at: string
  updated_at: string
}

export const useWorkflowStore = defineStore('workflow', () => {
  const workflows = ref<WorkflowItem[]>([])
  const currentWorkflow = ref<Record<string, unknown> | null>(null)
  const loading = ref(false)

  async function loadWorkflows(category?: string): Promise<void> {
    loading.value = true
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'workflow:list',
        category ? { category } : undefined
      )
      workflows.value = result || []
    } finally {
      loading.value = false
    }
  }

  async function getWorkflow(id: string): Promise<Record<string, unknown> | null> {
    const result = await window.electron.ipcRenderer.invoke('workflow:get', { id })
    currentWorkflow.value = result
    return result
  }

  async function deleteWorkflow(id: string): Promise<void> {
    await window.electron.ipcRenderer.invoke('workflow:delete', { id })
    workflows.value = workflows.value.filter((w) => w.id !== id)
  }

  async function updateWorkflow(id: string, data: Partial<Record<string, unknown>>): Promise<void> {
    await window.electron.ipcRenderer.invoke('workflow:update', { id, data: toPlain(data) })
    await loadWorkflows()
  }

  return {
    workflows,
    currentWorkflow,
    loading,
    loadWorkflows,
    getWorkflow,
    deleteWorkflow,
    updateWorkflow
  }
})
