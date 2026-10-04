import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { WorkflowMetadataPatch, WorkflowRecord } from '@shared/ipc-contract'
import { createLatestRequest } from '@renderer/utils/latest-request'

export interface WorkflowItem {
  id: string
  name: string
  description: string
  category: WorkflowRecord['category']
  variables: string
  created_at: string
  updated_at: string
}

export const useWorkflowStore = defineStore('workflow', () => {
  const workflows = ref<WorkflowItem[]>([])
  const loading = ref(false)

  const requests = createLatestRequest({
    read: (category: string | undefined) =>
      invokeIpc(IPC_CHANNELS.WORKFLOW_LIST, category ? { category } : undefined),
    commit: (result) => {
      workflows.value = result || []
    },
    loading: (value) => {
      loading.value = value
    },
    error: () => {}
  })

  function loadWorkflows(category?: string): Promise<void> {
    return requests.request(category)
  }

  async function deleteWorkflow(id: string): Promise<void> {
    await invokeIpc(IPC_CHANNELS.WORKFLOW_DELETE, { id })
    workflows.value = workflows.value.filter((w) => w.id !== id)
  }

  async function updateWorkflow(id: string, data: WorkflowMetadataPatch): Promise<void> {
    await invokeIpc(IPC_CHANNELS.WORKFLOW_UPDATE, { id, data })
    await loadWorkflows()
  }

  return {
    workflows,
    loading,
    loadWorkflows,
    deleteWorkflow,
    updateWorkflow
  }
})
