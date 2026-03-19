<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NButton, NEmpty, NSpace, NTag, NDataTable } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import { useWorkflowStore, type WorkflowItem } from '@renderer/stores/workflow.store'

const { t } = useI18n()
const workflowStore = useWorkflowStore()

const columns: DataTableColumns<WorkflowItem> = [
  { title: t('common.name'), key: 'name', width: 200 },
  { title: t('common.description'), key: 'description', ellipsis: { tooltip: true } },
  {
    title: t('common.type'),
    key: 'category',
    width: 120,
    render(row) {
      const colors: Record<string, string> = {
        generation: 'success',
        upscale: 'info',
        detailer: 'warning',
        custom: 'default'
      }
      return h(NTag, { type: (colors[row.category] || 'default') as 'success' | 'info' | 'warning' | 'default', size: 'small' }, {
        default: () => t(`workflow.category.${row.category}`)
      })
    }
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 150,
    render(row) {
      return h(NSpace, {}, {
        default: () => [
          h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => handleDelete(row.id) }, {
            default: () => t('common.delete')
          })
        ]
      })
    }
  }
]

async function handleImport(): Promise<void> {
  const filePath = await window.electron.ipcRenderer.invoke('dialog:open-file', {
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (filePath) {
    await window.electron.ipcRenderer.invoke('workflow:import', { filePath })
    await workflowStore.loadWorkflows()
  }
}

async function handleDelete(id: string): Promise<void> {
  await workflowStore.deleteWorkflow(id)
}

onMounted(() => {
  workflowStore.loadWorkflows()
})
</script>

<template>
  <div class="workflow-view">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>{{ t('workflow.title') }}</h2>
      <NButton type="primary" @click="handleImport">
        {{ t('workflow.import') }}
      </NButton>
    </div>

    <NCard style="margin-top: 16px;">
      <NDataTable
        v-if="workflowStore.workflows.length > 0"
        :columns="columns"
        :data="workflowStore.workflows"
        :loading="workflowStore.loading"
        :row-key="(row: WorkflowItem) => row.id"
      />
      <NEmpty v-else :description="t('workflow.empty')" />
    </NCard>
  </div>
</template>
