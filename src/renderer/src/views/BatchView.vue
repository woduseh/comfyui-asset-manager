<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NModal, NForm, NFormItem,
  NInput, NSelect, NInputNumber, NDataTable, NGrid, NGridItem,
  NDivider, NStatistic, NCheckboxGroup, NCheckbox, NAlert,
  NScrollbar, NSwitch, NSlider, useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import { useModuleStore, type PromptModule, type ModuleItem } from '@renderer/stores/module.store'
import { useWorkflowStore, type WorkflowItem } from '@renderer/stores/workflow.store'
import { toPlain } from '@renderer/utils/ipc'

const { t } = useI18n()
const message = useMessage()
const moduleStore = useModuleStore()
const workflowStore = useWorkflowStore()

// Batch jobs list
const batchJobs = ref<Record<string, unknown>[]>([])
const loadingJobs = ref(false)

// Matrix builder
const showBuilderModal = ref(false)
const batchName = ref('')
const batchDescription = ref('')
const selectedWorkflowId = ref<string | null>(null)
const countPerCombination = ref(1)
const seedMode = ref<'random' | 'fixed' | 'incremental'>('random')
const fixedSeed = ref(42)
const outputPattern = ref('{job}/{character}/{outfit}/{emotion}')
const filePattern = ref('{character}_{outfit}_{emotion}_{index}')

// Module selections in the matrix builder
interface ModuleSelectionUI {
  moduleId: string
  moduleName: string
  moduleType: string
  items: ModuleItem[]
  selectedItemIds: string[]
}
const moduleSelections = ref<ModuleSelectionUI[]>([])
const availableModules = ref<PromptModule[]>([])
const moduleToAdd = ref<string | null>(null)

// Prompt slot mappings
interface SlotMapping {
  variableId: string
  nodeId: string
  fieldName: string
  displayName: string
  role: string
  action: 'inject' | 'fixed'
  fixedValue: string
  assignedModuleIds: string[]
  prefixText: string
  suffixText: string
}
const slotMappings = ref<SlotMapping[]>([])

// Variable overrides
interface VariableOverride {
  variableId: string
  nodeId: string
  fieldName: string
  displayName: string
  varType: string
  role: string
  enabled: boolean
  value: string
  defaultValue: string
}
const variableOverrides = ref<VariableOverride[]>([])
const batchResources = ref<{
  checkpoints: string[]
  loras: string[]
  vaes: string[]
  upscaleModels: string[]
  samplers: string[]
  schedulers: string[]
} | null>(null)

const varTypeLabels: Record<string, string> = {
  text: '텍스트', number: '숫자', boolean: '불리언',
  seed: '시드', image: '이미지', model: '모델', lora: 'LoRA'
}

watch(selectedWorkflowId, async (id) => {
  if (!id) {
    slotMappings.value = []
    variableOverrides.value = []
    return
  }
  const variables = await window.electron.ipcRenderer.invoke('workflow:variables', { workflowId: id })
  slotMappings.value = variables
    .filter((v: Record<string, unknown>) => v.role === 'prompt_positive' || v.role === 'prompt_negative')
    .map((v: Record<string, unknown>) => ({
      variableId: v.id as string,
      nodeId: v.node_id as string,
      fieldName: v.field_name as string,
      displayName: v.display_name as string,
      role: v.role as string,
      action: 'inject' as const,
      fixedValue: (v.default_val as string) || '',
      assignedModuleIds: [] as string[],
      prefixText: '',
      suffixText: ''
    }))

  // Load ComfyUI resources for dropdowns
  try {
    batchResources.value = await window.electron.ipcRenderer.invoke('comfyui:models')
  } catch {
    batchResources.value = null
  }

  // Set up variable overrides for non-prompt variables
  variableOverrides.value = variables
    .filter((v: Record<string, unknown>) =>
      v.role !== 'prompt_positive' && v.role !== 'prompt_negative' && v.var_type !== 'seed'
    )
    .map((v: Record<string, unknown>) => ({
      variableId: v.id as string,
      nodeId: v.node_id as string,
      fieldName: v.field_name as string,
      displayName: v.display_name as string,
      varType: v.var_type as string,
      role: v.role as string,
      enabled: false,
      value: (v.default_val as string) || '',
      defaultValue: (v.default_val as string) || ''
    }))
})
// Computed stats
const taskPreview = computed(() => {
  const selections = moduleSelections.value.filter((s) => s.selectedItemIds.length > 0)
  if (selections.length === 0) return { totalCombinations: 0, totalTasks: 0 }
  let totalCombinations = 1
  for (const sel of selections) {
    totalCombinations *= sel.selectedItemIds.length
  }
  return {
    totalCombinations,
    totalTasks: totalCombinations * countPerCombination.value
  }
})

const workflowOptions = computed(() => {
  return workflowStore.workflows
    .filter((w) => w.category === 'generation')
    .map((w) => ({ label: w.name, value: w.id }))
})

const seedModeOptions = [
  { label: t('batch.seedMode.random'), value: 'random' },
  { label: t('batch.seedMode.fixed'), value: 'fixed' },
  { label: t('batch.seedMode.incremental'), value: 'incremental' }
]

const jobColumns: DataTableColumns = [
  { title: t('common.name'), key: 'name', width: 200 },
  {
    title: t('common.status'),
    key: 'status',
    width: 120,
    render(row) {
      const statusColors: Record<string, string> = {
        draft: 'default',
        queued: 'info',
        running: 'warning',
        paused: 'default',
        completed: 'success',
        failed: 'error',
        cancelled: 'default'
      }
      return h(NTag, { type: (statusColors[row.status as string] || 'default') as 'success' | 'info' | 'warning' | 'error' | 'default', size: 'small' }, {
        default: () => t(`batch.status.${row.status}`)
      })
    }
  },
  {
    title: '진행',
    key: 'progress',
    width: 150,
    render(row) {
      return `${row.completed_tasks ?? 0}/${row.total_tasks ?? 0}`
    }
  },
  { title: '생성일', key: 'created_at', width: 180 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 200,
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'tiny', quaternary: true, type: 'info', onClick: () => handleCloneJob(row) }, {
            default: () => '복제'
          }),
          h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => handleDeleteJob(row.id as string) }, {
            default: () => t('common.delete')
          })
        ]
      })
    }
  }
]

async function loadBatchJobs(): Promise<void> {
  loadingJobs.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('batch:list')
    batchJobs.value = result || []
  } finally {
    loadingJobs.value = false
  }
}

async function handleDeleteJob(id: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:delete', { id })
  await loadBatchJobs()
  message.success('삭제되었습니다')
}

async function openBuilder(): Promise<void> {
  await moduleStore.loadModules()
  await workflowStore.loadWorkflows()
  availableModules.value = moduleStore.modules
  moduleSelections.value = []
  variableOverrides.value = []
  batchResources.value = null
  batchName.value = ''
  batchDescription.value = ''
  selectedWorkflowId.value = workflowOptions.value.length > 0 ? workflowOptions.value[0].value : null
  showBuilderModal.value = true
}

async function addModuleToMatrix(moduleId: string): Promise<void> {
  if (!moduleId) return
  if (moduleSelections.value.some((s) => s.moduleId === moduleId)) return
  const mod = availableModules.value.find((m) => m.id === moduleId)
  if (!mod) return
  await moduleStore.loadItems(moduleId)
  const items = [...moduleStore.currentItems]
  moduleSelections.value.push({
    moduleId,
    moduleName: mod.name,
    moduleType: mod.type,
    items,
    selectedItemIds: items.filter((i) => i.enabled).map((i) => i.id)
  })
  moduleToAdd.value = null
}

function removeModuleFromMatrix(moduleId: string): void {
  moduleSelections.value = moduleSelections.value.filter((s) => s.moduleId !== moduleId)
}

async function handleCreateBatch(): Promise<void> {
  if (!batchName.value) {
    message.warning('배치 작업 이름을 입력해주세요')
    return
  }
  if (!selectedWorkflowId.value) {
    message.warning('워크플로우를 선택해주세요')
    return
  }
  if (taskPreview.value.totalTasks === 0) {
    message.warning('최소 하나의 모듈에서 아이템을 선택해주세요')
    return
  }

  try {
    const result = await window.electron.ipcRenderer.invoke('batch:create', toPlain({
      name: batchName.value,
      description: batchDescription.value,
      workflowId: selectedWorkflowId.value,
      moduleSelections: moduleSelections.value.map((s) => ({
        moduleId: s.moduleId,
        moduleType: s.moduleType,
        selectedItemIds: s.selectedItemIds
      })),
      countPerCombination: countPerCombination.value,
      seedMode: seedMode.value,
      fixedSeed: fixedSeed.value,
      outputFolderPattern: outputPattern.value,
      fileNamePattern: filePattern.value,
      slotMappings: slotMappings.value.map((s) => ({
        variableId: s.variableId,
        nodeId: s.nodeId,
        fieldName: s.fieldName,
        role: s.role,
        action: s.action,
        fixedValue: s.fixedValue,
        assignedModuleIds: s.assignedModuleIds,
        prefixText: s.prefixText,
        suffixText: s.suffixText
      })),
      variableOverrides: variableOverrides.value
        .filter(vo => vo.enabled)
        .map(vo => ({
          nodeId: vo.nodeId,
          fieldName: vo.fieldName,
          value: vo.value
        }))
    }))

    message.success(`배치 작업 생성 완료: ${result.totalTasks}개 태스크`)
    showBuilderModal.value = false
    await loadBatchJobs()
  } catch (error) {
    message.error('배치 작업 생성 실패: ' + (error as Error).message)
  }
}

async function handleCloneJob(job: Record<string, unknown>): Promise<void> {
  try {
    const config = JSON.parse(job.config as string)
    await moduleStore.loadModules()
    await workflowStore.loadWorkflows()
    availableModules.value = moduleStore.modules

    // Restore basic settings
    batchName.value = `${job.name as string} (복사)`
    batchDescription.value = config.description || ''
    selectedWorkflowId.value = config.workflowId || null
    countPerCombination.value = config.countPerCombination || 1
    seedMode.value = config.seedMode || 'random'
    fixedSeed.value = config.fixedSeed || 42
    outputPattern.value = config.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
    filePattern.value = config.fileNamePattern || '{character}_{outfit}_{emotion}_{index}'

    // Restore module selections
    moduleSelections.value = []
    if (config.moduleSelections && Array.isArray(config.moduleSelections)) {
      for (const sel of config.moduleSelections) {
        const mod = availableModules.value.find(m => m.id === sel.moduleId)
        if (mod) {
          await moduleStore.loadItems(sel.moduleId)
          const items = [...moduleStore.currentItems]
          moduleSelections.value.push({
            moduleId: sel.moduleId,
            moduleName: mod.name,
            moduleType: sel.moduleType || mod.type,
            items,
            selectedItemIds: sel.selectedItemIds || items.map(i => i.id)
          })
        }
      }
    }

    showBuilderModal.value = true

    // Restore slot mapping actions after watcher runs
    if (config.slotMappings && Array.isArray(config.slotMappings)) {
      setTimeout(() => {
        for (const savedSlot of config.slotMappings) {
          const slot = slotMappings.value.find(s =>
            s.nodeId === savedSlot.nodeId && s.fieldName === savedSlot.fieldName
          )
          if (slot) {
            slot.action = savedSlot.action || 'inject'
            slot.fixedValue = savedSlot.fixedValue || ''
            slot.assignedModuleIds = savedSlot.assignedModuleIds || []
            slot.prefixText = savedSlot.prefixText || ''
            slot.suffixText = savedSlot.suffixText || ''
          }
        }
      }, 500)
    }

    // Restore variable overrides after watcher runs
    if (config.variableOverrides && Array.isArray(config.variableOverrides)) {
      setTimeout(() => {
        for (const savedOverride of config.variableOverrides) {
          const vo = variableOverrides.value.find(v =>
            v.nodeId === savedOverride.nodeId && v.fieldName === savedOverride.fieldName
          )
          if (vo) {
            vo.enabled = true
            vo.value = savedOverride.value || ''
          }
        }
      }, 500)
    }

    message.info('배치 설정을 복원했습니다. 수정 후 새로 생성해주세요.')
  } catch (e) {
    message.error('배치 작업 복제 실패: ' + (e instanceof Error ? e.message : String(e)))
  }
}

onMounted(() => {
  loadBatchJobs()
})
</script>

<template>
  <div class="batch-view">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>{{ t('batch.title') }}</h2>
      <NButton type="primary" @click="openBuilder">
        {{ t('batch.create') }}
      </NButton>
    </div>

    <NCard style="margin-top: 16px;">
      <NDataTable
        v-if="batchJobs.length > 0"
        :columns="jobColumns"
        :data="batchJobs"
        :loading="loadingJobs"
        :row-key="(row: Record<string, unknown>) => row.id as string"
      />
      <NEmpty v-else :description="t('batch.empty')" />
    </NCard>

    <!-- Matrix Builder Modal -->
    <NModal
      v-model:show="showBuilderModal"
      preset="card"
      style="width: 900px; max-height: 85vh;"
      :title="t('batch.builder')"
      :bordered="false"
    >
      <NScrollbar style="max-height: 70vh;">
        <NForm label-placement="left" :label-width="140">
          <!-- Basic info -->
          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('common.name')">
                <NInput v-model:value="batchName" placeholder="배치 작업 이름" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="워크플로우">
                <NSelect
                  v-model:value="selectedWorkflowId"
                  :options="workflowOptions"
                  placeholder="생성용 워크플로우 선택"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NFormItem :label="t('common.description')">
            <NInput v-model:value="batchDescription" placeholder="설명 (선택사항)" />
          </NFormItem>

          <NDivider>모듈 선택 (매트릭스)</NDivider>

          <!-- Module selection -->
          <NFormItem label="모듈 추가">
            <NSelect
              v-model:value="moduleToAdd"
              placeholder="매트릭스에 추가할 모듈 선택"
              :options="availableModules.filter(m => !moduleSelections.some(s => s.moduleId === m.id)).map(m => ({ label: `${m.name} (${t('module.type.' + m.type)})`, value: m.id }))"
              @update:value="addModuleToMatrix"
            />
          </NFormItem>

          <!-- Selected modules with item checkboxes -->
          <template v-for="sel in moduleSelections" :key="sel.moduleId">
            <NCard size="small" style="margin-bottom: 12px;">
              <template #header>
                <NSpace align="center">
                  <NTag size="small">{{ t('module.type.' + sel.moduleType) }}</NTag>
                  <span>{{ sel.moduleName }}</span>
                  <NTag size="tiny" round>{{ sel.selectedItemIds.length }}/{{ sel.items.length }}</NTag>
                </NSpace>
              </template>
              <template #header-extra>
                <NSpace :size="4">
                  <NButton size="tiny" quaternary @click="sel.selectedItemIds = sel.items.map(i => i.id)">전체 선택</NButton>
                  <NButton size="tiny" quaternary @click="sel.selectedItemIds = []">전체 해제</NButton>
                  <NButton size="tiny" quaternary type="error" @click="removeModuleFromMatrix(sel.moduleId)">제거</NButton>
                </NSpace>
              </template>
              <NCheckboxGroup v-model:value="sel.selectedItemIds">
                <NSpace>
                  <NCheckbox v-for="item in sel.items" :key="item.id" :value="item.id" :label="item.name" />
                </NSpace>
              </NCheckboxGroup>
              <NAlert v-if="sel.items.length === 0" type="warning" style="margin-top: 8px; font-size: 12px;">
                이 모듈에 아이템이 없습니다. 프롬프트 모듈 관리에서 아이템을 추가해주세요.
              </NAlert>
            </NCard>
          </template>

          <NDivider>프롬프트 슬롯 매핑</NDivider>

          <NAlert v-if="slotMappings.length === 0" type="info" style="margin-bottom: 12px; font-size: 12px;">
            워크플로우에 감지된 프롬프트 슬롯이 없습니다. 워크플로우 상세에서 변수 역할을 설정해주세요.
          </NAlert>
          <template v-for="slot in slotMappings" :key="slot.variableId">
            <NCard size="small" style="margin-bottom: 8px;">
              <NSpace align="center" justify="space-between">
                <NSpace align="center">
                  <NTag size="small" :type="slot.role === 'prompt_positive' ? 'success' : 'error'">
                    {{ slot.role === 'prompt_positive' ? '긍정' : '부정' }}
                  </NTag>
                  <span>{{ slot.displayName }}</span>
                </NSpace>
                <NSelect
                  v-model:value="slot.action"
                  :options="[
                    { label: '모듈 프롬프트 주입', value: 'inject' },
                    { label: '고정값 사용', value: 'fixed' }
                  ]"
                  size="small"
                  style="width: 180px;"
                />
              </NSpace>

              <!-- Fixed value mode -->
              <NInput
                v-if="slot.action === 'fixed'"
                v-model:value="slot.fixedValue"
                type="textarea"
                :rows="2"
                placeholder="고정 프롬프트 텍스트"
                style="margin-top: 8px;"
              />

              <!-- Inject mode with per-slot module control -->
              <template v-if="slot.action === 'inject'">
                <!-- Prefix text -->
                <NInput
                  v-model:value="slot.prefixText"
                  type="textarea"
                  :rows="2"
                  placeholder="고정 프리픽스 (예: masterpiece, best quality, 1girl)"
                  size="small"
                  style="margin-top: 8px;"
                />

                <!-- Module assignment -->
                <div v-if="moduleSelections.length > 0" style="margin-top: 8px;">
                  <span style="font-size: 12px; opacity: 0.7; margin-bottom: 4px; display: block;">주입할 모듈 선택:</span>
                  <NCheckboxGroup v-model:value="slot.assignedModuleIds">
                    <NSpace>
                      <NCheckbox
                        v-for="sel in moduleSelections"
                        :key="sel.moduleId"
                        :value="sel.moduleId"
                        :label="`${sel.moduleName} (${t('module.type.' + sel.moduleType)})`"
                      />
                    </NSpace>
                  </NCheckboxGroup>
                </div>
                <NAlert v-else type="info" style="margin-top: 8px; font-size: 12px;">
                  매트릭스에 모듈을 추가하면 이 슬롯에 주입할 모듈을 선택할 수 있습니다.
                </NAlert>

                <!-- Suffix text -->
                <NInput
                  v-model:value="slot.suffixText"
                  type="textarea"
                  :rows="2"
                  placeholder="고정 서픽스 (선택사항)"
                  size="small"
                  style="margin-top: 8px;"
                />
              </template>
            </NCard>
          </template>

          <NDivider>워크플로우 변수 오버라이드</NDivider>

          <NAlert v-if="variableOverrides.length === 0" type="info" style="margin-bottom: 12px; font-size: 12px;">
            오버라이드 가능한 변수가 없습니다.
          </NAlert>

          <template v-for="vo in variableOverrides" :key="vo.variableId">
            <NCard size="small" style="margin-bottom: 8px;">
              <NSpace align="center" justify="space-between">
                <NSpace align="center">
                  <NSwitch v-model:value="vo.enabled" size="small" />
                  <NTag size="small" :type="vo.varType === 'model' ? 'success' : vo.varType === 'lora' ? 'warning' : 'default'">
                    {{ varTypeLabels[vo.varType] || vo.varType }}
                  </NTag>
                  <span :style="{ opacity: vo.enabled ? 1 : 0.5 }">{{ vo.displayName }}</span>
                </NSpace>
                <span v-if="!vo.enabled" style="font-size: 12px; opacity: 0.5;">기본값: {{ vo.defaultValue || '(없음)' }}</span>
              </NSpace>

              <template v-if="vo.enabled">
                <div style="margin-top: 8px;">
                  <!-- Model dropdown -->
                  <NSelect
                    v-if="vo.varType === 'model'"
                    v-model:value="vo.value"
                    :options="(batchResources?.checkpoints || []).map(c => ({ label: c, value: c }))"
                    placeholder="체크포인트 선택"
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <!-- LoRA dropdown -->
                  <NSelect
                    v-else-if="vo.varType === 'lora'"
                    v-model:value="vo.value"
                    :options="(batchResources?.loras || []).map(l => ({ label: l, value: l }))"
                    placeholder="LoRA 선택"
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <!-- LoRA weights -->
                  <NSpace v-else-if="vo.varType === 'number' && (vo.fieldName === 'strength_model' || vo.fieldName === 'strength_clip')" align="center">
                    <NSlider
                      :value="Number(vo.value) || 1"
                      :min="0" :max="2" :step="0.05"
                      style="width: 200px;"
                      @update:value="(v: number) => { vo.value = String(v) }"
                    />
                    <NInputNumber
                      :value="Number(vo.value) || 1"
                      :min="0" :max="2" :step="0.05"
                      size="small" style="width: 100px;"
                      @update:value="(v: number | null) => { vo.value = String(v ?? 1) }"
                    />
                  </NSpace>
                  <!-- Sampler/Scheduler dropdowns -->
                  <NSelect
                    v-else-if="vo.fieldName === 'sampler_name'"
                    v-model:value="vo.value"
                    :options="(batchResources?.samplers || []).map(s => ({ label: s, value: s }))"
                    filterable size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <NSelect
                    v-else-if="vo.fieldName === 'scheduler'"
                    v-model:value="vo.value"
                    :options="(batchResources?.schedulers || []).map(s => ({ label: s, value: s }))"
                    filterable size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <!-- Number -->
                  <NInputNumber
                    v-else-if="vo.varType === 'number'"
                    :value="Number(vo.value) || 0"
                    size="small" style="width: 200px;"
                    @update:value="(v: number | null) => { vo.value = String(v ?? 0) }"
                  />
                  <!-- Text -->
                  <NInput
                    v-else
                    v-model:value="vo.value"
                    type="textarea" :rows="2" size="small"
                    placeholder="오버라이드 값"
                  />
                </div>
              </template>
            </NCard>
          </template>

          <NDivider>생성 설정</NDivider>

          <NGrid :cols="3" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('batch.countPerCombination')">
                <NInputNumber v-model:value="countPerCombination" :min="1" :max="10000" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('batch.seedMode.title')">
                <NSelect v-model:value="seedMode" :options="seedModeOptions" />
              </NFormItem>
            </NGridItem>
            <NGridItem v-if="seedMode !== 'random'">
              <NFormItem label="시드 값">
                <NInputNumber v-model:value="fixedSeed" :min="0" :max="2147483647" />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NDivider>출력 설정</NDivider>

          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem label="폴더 패턴">
                <NInput v-model:value="outputPattern" placeholder="{job}/{character}/{outfit}/{emotion}" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="파일명 패턴">
                <NInput v-model:value="filePattern" placeholder="{character}_{outfit}_{emotion}_{index}" />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NAlert type="info" style="margin-top: 8px; font-size: 12px;">
            사용 가능한 변수: {job}, {character}, {outfit}, {emotion}, {style}, {seed}, {date}, {index}
          </NAlert>

          <!-- Preview Stats -->
          <NDivider>미리보기</NDivider>
          <NGrid :cols="3" :x-gap="16">
            <NGridItem>
              <NStatistic label="모듈 차원" :value="moduleSelections.filter(s => s.selectedItemIds.length > 0).length" />
            </NGridItem>
            <NGridItem>
              <NStatistic label="총 조합 수" :value="taskPreview.totalCombinations" />
            </NGridItem>
            <NGridItem>
              <NStatistic label="총 생성 이미지 수" :value="taskPreview.totalTasks" />
            </NGridItem>
          </NGrid>

          <NAlert
            v-if="taskPreview.totalTasks === 0 && moduleSelections.length > 0"
            type="info"
            style="margin-top: 12px; font-size: 12px;"
          >
            선택된 아이템이 있는 모듈이 필요합니다. 모듈에 아이템을 추가하고 체크해주세요.
          </NAlert>

          <NAlert
            v-if="moduleSelections.length === 0"
            type="info"
            style="margin-top: 12px; font-size: 12px;"
          >
            위에서 모듈을 추가하면 조합 매트릭스가 생성됩니다.
          </NAlert>

          <NAlert
            v-if="taskPreview.totalTasks > 10000"
            type="warning"
            style="margin-top: 12px;"
          >
            ⚠️ 생성할 이미지가 {{ taskPreview.totalTasks.toLocaleString() }}장으로 매우 많습니다. 실행 시간이 오래 걸릴 수 있습니다.
          </NAlert>
        </NForm>
      </NScrollbar>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showBuilderModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :disabled="taskPreview.totalTasks === 0" @click="handleCreateBatch">
            배치 작업 생성 ({{ taskPreview.totalTasks.toLocaleString() }}장)
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
