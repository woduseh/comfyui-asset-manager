<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NDataTable, NModal,
  NInput, NSelect, NForm, NFormItem, NScrollbar,
  useMessage
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
const editName = ref('')
const editDescription = ref('')

const columns: DataTableColumns<WorkflowItem> = [
  { title: t('common.name'), key: 'name', ellipsis: { tooltip: true } },
  {
    title: t('common.type'),
    key: 'category',
    width: 100,
    render(row) {
      const colors: Record<string, string> = {
        generation: 'success',
        upscale: 'info',
        detailer: 'warning',
        custom: 'default'
      }
      return h(NTag, { type: (colors[row.category] || 'default') as 'success' | 'info' | 'warning' | 'default', size: 'small', round: true }, {
        default: () => t(`workflow.category.${row.category}`)
      })
    }
  },
  {
    title: t('workflow.variables'),
    key: 'variables',
    width: 80,
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
    width: 160,
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', quaternary: true, type: 'info', onClick: () => handleViewDetail(row.id) }, {
            default: () => t('common.detail')
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
      message.success(`워크플로우 "${result.name}" 가져오기 완료 (변수 ${result.variableCount}개)`)
      await workflowStore.loadWorkflows()
    }
  }
}

async function handleViewDetail(id: string): Promise<void> {
  detailWorkflow.value = await workflowStore.getWorkflow(id)
  if (detailWorkflow.value) {
    editName.value = (detailWorkflow.value.name as string) || ''
    editDescription.value = (detailWorkflow.value.description as string) || ''
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

async function handleSaveWorkflow(): Promise<void> {
  if (!detailWorkflow.value) return
  const id = detailWorkflow.value.id as string
  try {
    await workflowStore.updateWorkflow(id, {
      name: editName.value,
      description: editDescription.value
    })
    detailWorkflow.value.name = editName.value
    detailWorkflow.value.description = editDescription.value
    message.success('워크플로우가 수정되었습니다')
    showDetailModal.value = false
  } catch (e) {
    message.error(`수정 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const categoryOptions = [
  { label: t('workflow.category.generation'), value: 'generation' },
  { label: t('workflow.category.upscale'), value: 'upscale' },
  { label: t('workflow.category.detailer'), value: 'detailer' },
  { label: t('workflow.category.custom'), value: 'custom' }
]

const roleOptions = [
  { label: '긍정 프롬프트', value: 'prompt_positive' },
  { label: '부정 프롬프트', value: 'prompt_negative' },
  { label: '시드', value: 'seed' },
  { label: '고정값', value: 'fixed' },
  { label: '사용자 정의', value: 'custom' }
]

const roleColors: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  prompt_positive: 'success',
  prompt_negative: 'error',
  seed: 'warning',
  fixed: 'info',
  custom: 'default'
}

const roleLabels: Record<string, string> = {
  prompt_positive: '긍정',
  prompt_negative: '부정',
  seed: '시드',
  fixed: '고정',
  custom: '사용자'
}

const varTypeLabels: Record<string, string> = {
  text: '텍스트',
  number: '숫자',
  boolean: '불리언',
  seed: '시드',
  image: '이미지',
  model: '모델',
  lora: 'LoRA'
}

async function handleRoleChange(variableId: string, role: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('workflow:update-variable-role', { variableId, role })
  const v = detailVariables.value.find((v) => v.id === variableId)
  if (v) v.role = role
}

onMounted(() => {
  workflowStore.loadWorkflows()
})
</script>

<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">{{ t('workflow.title') }}</h2>
      <NButton type="primary" @click="handleImport">
        {{ t('workflow.import') }}
      </NButton>
    </div>

    <NCard>
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
      style="width: 640px;"
      :title="(detailWorkflow?.name as string) || ''"
      :bordered="false"
    >
      <template v-if="detailWorkflow">
        <NForm label-placement="left" label-width="80">
          <NFormItem :label="t('common.name')">
            <NInput v-model:value="editName" />
          </NFormItem>
          <NFormItem :label="t('common.description')">
            <NInput v-model:value="editDescription" type="textarea" :rows="2" />
          </NFormItem>
          <NFormItem :label="t('common.type')">
            <NSelect
              :value="(detailWorkflow.category as string)"
              :options="categoryOptions"
              @update:value="(v: string) => handleCategoryChange(detailWorkflow!.id as string, v)"
            />
          </NFormItem>
        </NForm>

        <div style="margin-top: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 600;">변수 목록 ({{ detailVariables.length }})</span>
          </div>
          <NScrollbar style="max-height: 300px;" v-if="detailVariables.length > 0">
            <div
              v-for="variable in detailVariables"
              :key="(variable.id as string)"
              style="padding: 10px 12px; border-radius: 8px; background: rgba(128,128,128,0.06); margin-bottom: 6px;"
            >
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <NTag size="small" round :type="(variable.var_type === 'text' ? 'info' : variable.var_type === 'seed' ? 'warning' : variable.var_type === 'model' ? 'success' : 'default') as 'info' | 'warning' | 'success' | 'default'">
                  {{ varTypeLabels[variable.var_type as string] || variable.var_type }}
                </NTag>
                <strong style="font-size: 13px;">{{ variable.display_name }}</strong>
                <span style="opacity: 0.45; font-size: 11px; margin-left: auto;">
                  {{ variable.node_id }}:{{ variable.field_name }}
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
                <span style="font-size: 12px; opacity: 0.6;">역할:</span>
                <NSelect
                  :value="(variable.role as string) || 'custom'"
                  :options="roleOptions"
                  size="small"
                  style="width: 150px;"
                  @update:value="(v: string) => handleRoleChange(variable.id as string, v)"
                />
                <NTag size="small" :type="roleColors[(variable.role as string) || 'custom']" round>
                  {{ roleLabels[(variable.role as string) || 'custom'] }}
                </NTag>
              </div>
              <div v-if="variable.default_val" style="margin-top: 4px; font-size: 11px; opacity: 0.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                기본값: {{ variable.default_val }}
              </div>
            </div>
          </NScrollbar>
          <NEmpty v-else :description="t('workflow.noVariables')" style="padding: 20px 0;" />
        </div>
      </template>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showDetailModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" @click="handleSaveWorkflow">{{ t('common.save') }}</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
