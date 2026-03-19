<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NDataTable, NModal,
  NCollapse, NCollapseItem,
  NInput, NSelect, NForm, NFormItem, NSlider, NInputNumber,
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

// ComfyUI available resources
const comfyuiResources = ref<{
  checkpoints: string[]
  loras: string[]
  vaes: string[]
  upscaleModels: string[]
  samplers: string[]
  schedulers: string[]
} | null>(null)
const resourcesLoading = ref(false)
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
      message.success(`워크플로우 "${result.name}" 가져오기 완료 (변수 ${result.variableCount}개 감지, 카테고리: ${result.category})`)
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
    loadComfyUIResources()
  }
}

async function loadComfyUIResources(): Promise<void> {
  resourcesLoading.value = true
  try {
    comfyuiResources.value = await window.electron.ipcRenderer.invoke('comfyui:models')
  } catch {
    comfyuiResources.value = null
  } finally {
    resourcesLoading.value = false
  }
}

let valueUpdateTimer: ReturnType<typeof setTimeout> | null = null
async function handleValueChange(variableId: string, value: unknown): Promise<void> {
  const v = detailVariables.value.find(v => v.id === variableId)
  if (v) v.default_val = String(value ?? '')

  if (valueUpdateTimer) clearTimeout(valueUpdateTimer)
  valueUpdateTimer = setTimeout(async () => {
    await window.electron.ipcRenderer.invoke('workflow:update-variable-value', {
      variableId,
      value: String(value ?? '')
    })
  }, 300)
}

function isLoraWeight(variable: Record<string, unknown>): boolean {
  const fieldName = (variable.field_name as string) || ''
  return fieldName === 'strength_model' || fieldName === 'strength_clip'
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

const varTypeLabels: Record<string, string> = {
  text: '텍스트',
  number: '숫자',
  boolean: '불리언',
  seed: '시드',
  image: '이미지',
  model: '모델',
  lora: 'LoRA'
}

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
      style="width: 800px; max-height: 85vh;"
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

        <NCollapse style="margin-top: 16px;" :default-expanded-names="['variables']">
          <NCollapseItem :title="`${t('workflow.variables')} (${detailVariables.length})`" name="variables">
            <template v-if="detailVariables.length > 0">
              <div style="max-height: 320px; overflow-y: auto; padding-right: 4px;">
                <div v-for="variable in detailVariables" :key="(variable.id as string)" style="padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,0.2);">
                  <NSpace align="center">
                    <NTag size="small" :type="(variable.var_type === 'text' ? 'info' : variable.var_type === 'seed' ? 'warning' : 'default') as 'info' | 'warning' | 'default'">
                      {{ varTypeLabels[variable.var_type as string] || variable.var_type }}
                    </NTag>
                    <NTag size="small" :type="roleColors[(variable.role as string) || 'custom']">
                      {{ roleLabels[(variable.role as string) || 'custom'] }}
                    </NTag>
                    <strong>{{ variable.display_name }}</strong>
                    <span style="opacity: 0.6; font-size: 12px;">
                      Node {{ variable.node_id }} → {{ variable.field_name }}
                    </span>
                  </NSpace>
                  <NSpace align="center" style="margin-top: 6px; padding-left: 8px;">
                    <span style="font-size: 12px; opacity: 0.7;">역할:</span>
                    <NSelect
                      :value="(variable.role as string) || 'custom'"
                      :options="roleOptions"
                      size="small"
                      style="width: 160px;"
                      @update:value="(v: string) => handleRoleChange(variable.id as string, v)"
                    />
                  </NSpace>
                  <div style="margin-top: 6px; padding-left: 8px;">
                    <!-- Model type: checkpoint dropdown -->
                    <template v-if="variable.var_type === 'model'">
                      <NSelect
                        :value="(variable.default_val as string) || undefined"
                        :options="(comfyuiResources?.checkpoints || []).map(c => ({ label: c, value: c }))"
                        placeholder="체크포인트 선택"
                        filterable
                        size="small"
                        :loading="resourcesLoading"
                        :fallback-option="(v: string) => ({ label: v, value: v })"
                        @update:value="(v: string) => handleValueChange(variable.id as string, v)"
                      />
                    </template>

                    <!-- LoRA type: lora dropdown -->
                    <template v-else-if="variable.var_type === 'lora'">
                      <NSelect
                        :value="(variable.default_val as string) || undefined"
                        :options="(comfyuiResources?.loras || []).map(l => ({ label: l, value: l }))"
                        placeholder="LoRA 선택"
                        filterable
                        size="small"
                        :loading="resourcesLoading"
                        :fallback-option="(v: string) => ({ label: v, value: v })"
                        @update:value="(v: string) => handleValueChange(variable.id as string, v)"
                      />
                    </template>

                    <!-- Seed type: number + random button -->
                    <template v-else-if="variable.var_type === 'seed'">
                      <NSpace align="center">
                        <NInputNumber
                          :value="Number(variable.default_val) || 0"
                          :min="0"
                          :max="2147483647"
                          size="small"
                          style="width: 200px;"
                          @update:value="(v: number | null) => handleValueChange(variable.id as string, v ?? 0)"
                        />
                        <NButton size="tiny" quaternary @click="handleValueChange(variable.id as string, Math.floor(Math.random() * 2147483647))">
                          🎲
                        </NButton>
                      </NSpace>
                    </template>

                    <!-- Number type for LoRA weights (strength_model, strength_clip) -->
                    <template v-else-if="variable.var_type === 'number' && isLoraWeight(variable)">
                      <NSpace align="center" style="width: 100%;">
                        <NSlider
                          :value="Number(variable.default_val) || 1"
                          :min="0"
                          :max="2"
                          :step="0.05"
                          style="width: 200px;"
                          @update:value="(v: number) => handleValueChange(variable.id as string, v)"
                        />
                        <NInputNumber
                          :value="Number(variable.default_val) || 1"
                          :min="0"
                          :max="2"
                          :step="0.05"
                          size="small"
                          style="width: 100px;"
                          @update:value="(v: number | null) => handleValueChange(variable.id as string, v ?? 1)"
                        />
                      </NSpace>
                    </template>

                    <!-- Sampler dropdown -->
                    <template v-else-if="(variable.field_name as string) === 'sampler_name'">
                      <NSelect
                        :value="(variable.default_val as string) || undefined"
                        :options="(comfyuiResources?.samplers || []).map(s => ({ label: s, value: s }))"
                        placeholder="샘플러 선택"
                        filterable
                        size="small"
                        :loading="resourcesLoading"
                        :fallback-option="(v: string) => ({ label: v, value: v })"
                        @update:value="(v: string) => handleValueChange(variable.id as string, v)"
                      />
                    </template>

                    <!-- Scheduler dropdown -->
                    <template v-else-if="(variable.field_name as string) === 'scheduler'">
                      <NSelect
                        :value="(variable.default_val as string) || undefined"
                        :options="(comfyuiResources?.schedulers || []).map(s => ({ label: s, value: s }))"
                        placeholder="스케줄러 선택"
                        filterable
                        size="small"
                        :loading="resourcesLoading"
                        :fallback-option="(v: string) => ({ label: v, value: v })"
                        @update:value="(v: string) => handleValueChange(variable.id as string, v)"
                      />
                    </template>

                    <!-- Regular number type -->
                    <template v-else-if="variable.var_type === 'number'">
                      <NInputNumber
                        :value="Number(variable.default_val) || 0"
                        size="small"
                        style="width: 200px;"
                        @update:value="(v: number | null) => handleValueChange(variable.id as string, v ?? 0)"
                      />
                    </template>

                    <!-- Text type: textarea -->
                    <template v-else-if="variable.var_type === 'text'">
                      <NInput
                        :value="(variable.default_val as string) || ''"
                        type="textarea"
                        :rows="2"
                        size="small"
                        @update:value="(v: string) => handleValueChange(variable.id as string, v)"
                      />
                    </template>

                    <!-- Fallback: text input -->
                    <template v-else>
                      <NInput
                        :value="(variable.default_val as string) || ''"
                        size="small"
                        placeholder="값 입력"
                        @update:value="(v: string) => handleValueChange(variable.id as string, v)"
                      />
                    </template>
                  </div>
                </div>
              </div>
            </template>
            <NEmpty v-else :description="t('workflow.noVariables')" />
          </NCollapseItem>
        </NCollapse>
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
