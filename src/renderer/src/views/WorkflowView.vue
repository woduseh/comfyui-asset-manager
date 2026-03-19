<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NDataTable, NModal,
  NDescriptions, NDescriptionsItem, NCollapse, NCollapseItem,
  NInput, NInputNumber, NSelect, useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import { useWorkflowStore, type WorkflowItem } from '@renderer/stores/workflow.store'

const { t } = useI18n()
const message = useMessage()
const workflowStore = useWorkflowStore()

const showDetailModal = ref(false)
const detailWorkflow = ref<Record<string, unknown> | null>(null)
const detailVariables = ref<Record<string, unknown>[]>([])

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
    title: t('workflow.variables'),
    key: 'variables',
    width: 100,
    render(row) {
      try {
        const vars = JSON.parse(row.variables || '[]')
        return h(NTag, { size: 'small', round: true }, { default: () => `${vars.length}` })
      } catch {
        return h(NTag, { size: 'small', round: true }, { default: () => '0' })
      }
    }
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 200,
    render(row) {
      return h(NSpace, {}, {
        default: () => [
          h(NButton, { size: 'small', quaternary: true, type: 'info', onClick: () => handleViewDetail(row.id) }, {
            default: () => t('common.edit')
          }),
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
    const result = await window.electron.ipcRenderer.invoke('workflow:import', { filePath })
    if (result.error) {
      message.error(result.error)
    } else {
      message.success(`워크플로우 "${result.name}" 가져오기 완료 (변수 ${result.variableCount}개 감지, 카테고리: ${result.category})`)
      await workflowStore.loadWorkflows()
    }
  }
}

async function handleViewDetail(id: string): Promise<void> {
  detailWorkflow.value = await workflowStore.getWorkflow(id)
  if (detailWorkflow.value) {
    detailVariables.value = await window.electron.ipcRenderer.invoke('workflow:variables', { workflowId: id })
    showDetailModal.value = true
  }
}

async function handleDelete(id: string): Promise<void> {
  await workflowStore.deleteWorkflow(id)
  message.success('삭제되었습니다')
}

async function handleCategoryChange(id: string, category: string): Promise<void> {
  await workflowStore.updateWorkflow(id, { category })
  if (detailWorkflow.value && detailWorkflow.value.id === id) {
    detailWorkflow.value.category = category
  }
}

const categoryOptions = [
  { label: t('workflow.category.generation'), value: 'generation' },
  { label: t('workflow.category.upscale'), value: 'upscale' },
  { label: t('workflow.category.detailer'), value: 'detailer' },
  { label: t('workflow.category.custom'), value: 'custom' }
]

const varTypeLabels: Record<string, string> = {
  text: '텍스트',
  number: '숫자',
  boolean: '불리언',
  seed: '시드',
  image: '이미지',
  model: '모델',
  lora: 'LoRA'
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

    <!-- Workflow Detail Modal -->
    <NModal
      v-model:show="showDetailModal"
      preset="card"
      style="width: 800px; max-height: 80vh;"
      :title="(detailWorkflow?.name as string) || ''"
      :bordered="false"
    >
      <template v-if="detailWorkflow">
        <NDescriptions label-placement="left" :column="2" bordered>
          <NDescriptionsItem :label="t('common.name')">
            {{ detailWorkflow.name }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('common.type')">
            <NSelect
              :value="(detailWorkflow.category as string)"
              :options="categoryOptions"
              size="small"
              style="width: 140px;"
              @update:value="(v: string) => handleCategoryChange(detailWorkflow!.id as string, v)"
            />
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('common.description')" :span="2">
            {{ detailWorkflow.description || '-' }}
          </NDescriptionsItem>
        </NDescriptions>

        <NCollapse style="margin-top: 16px;" :default-expanded-names="['variables']">
          <NCollapseItem :title="`${t('workflow.variables')} (${detailVariables.length})`" name="variables">
            <template v-if="detailVariables.length > 0">
              <div v-for="variable in detailVariables" :key="(variable.id as string)" style="padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,0.2);">
                <NSpace align="center">
                  <NTag size="small" :type="(variable.var_type === 'text' ? 'info' : variable.var_type === 'seed' ? 'warning' : 'default') as 'info' | 'warning' | 'default'">
                    {{ varTypeLabels[variable.var_type as string] || variable.var_type }}
                  </NTag>
                  <strong>{{ variable.display_name }}</strong>
                  <span style="opacity: 0.6; font-size: 12px;">
                    Node {{ variable.node_id }} → {{ variable.field_name }}
                  </span>
                </NSpace>
                <div style="margin-top: 4px; padding-left: 8px; opacity: 0.8; font-size: 13px;">
                  기본값: {{ variable.default_val ?? '(없음)' }}
                </div>
              </div>
            </template>
            <NEmpty v-else :description="t('workflow.noVariables')" />
          </NCollapseItem>
        </NCollapse>
      </template>
    </NModal>
  </div>
</template>
