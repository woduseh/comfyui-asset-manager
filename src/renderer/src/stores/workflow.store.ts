import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'

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
      const result = await invokeIpc(
        IPC_CHANNELS.WORKFLOW_LIST,
        category ? { category } : undefined
      )
      workflows.value = result || []
    } finally {
      loading.value = false
    }
  }

  async function getWorkflow(id: string): Promise<Record<string, unknown> | null> {
    const result = await invokeIpc(IPC_CHANNELS.WORKFLOW_GET, { id })
    currentWorkflow.value = result
    return result
  }

  async function deleteWorkflow(id: string): Promise<void> {
    await invokeIpc(IPC_CHANNELS.WORKFLOW_DELETE, { id })
    workflows.value = workflows.value.filter((w) => w.id !== id)
  }

  async function updateWorkflow(id: string, data: Partial<Record<string, unknown>>): Promise<void> {
    await invokeIpc(IPC_CHANNELS.WORKFLOW_UPDATE, { id, data })
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
