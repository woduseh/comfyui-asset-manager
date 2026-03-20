<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NButton,
  NEmpty,
  NSpace,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NInputNumber,
  NDataTable,
  NGrid,
  NGridItem,
  NDivider,
  NStatistic,
  NCheckboxGroup,
  NCheckbox,
  NAlert,
  NScrollbar,
  NSwitch,
  NSlider,
  useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import { useModuleStore, type PromptModule, type ModuleItem } from '@renderer/stores/module.store'
import { useWorkflowStore } from '@renderer/stores/workflow.store'
import { toPlain } from '@renderer/utils/ipc'
import {
  addModuleToMatrix as addModuleToMatrixShared,
  restoreModuleSelections,
  restoreSlotMappings,
  restoreVariableOverrides
} from '@renderer/composables/useBatchWizard'

const { t } = useI18n()
const message = useMessage()
const moduleStore = useModuleStore()
const workflowStore = useWorkflowStore()

// Batch jobs list
const batchJobs = ref<Record<string, unknown>[]>([])
const loadingJobs = ref(false)
const editingJobId = ref<string | null>(null)

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
  prefixModuleIds: string[]
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
  text: t('workflow.varType.text'),
  number: t('workflow.varType.number'),
  boolean: t('workflow.varType.boolean'),
  seed: t('workflow.varType.seed'),
  image: t('workflow.varType.image'),
  model: t('workflow.varType.model'),
  lora: t('workflow.varType.lora')
}

watch(selectedWorkflowId, async (id) => {
  if (!id) {
    slotMappings.value = []
    variableOverrides.value = []
    return
  }
  const variables = await window.electron.ipcRenderer.invoke('workflow:variables', {
    workflowId: id
  })
  slotMappings.value = variables
    .filter(
      (v: Record<string, unknown>) => v.role === 'prompt_positive' || v.role === 'prompt_negative'
    )
    .map((v: Record<string, unknown>) => ({
      variableId: v.id as string,
      nodeId: v.node_id as string,
      fieldName: v.field_name as string,
      displayName: v.display_name as string,
      role: v.role as string,
      action: 'inject' as const,
      fixedValue: (v.default_val as string) || '',
      assignedModuleIds: [] as string[],
      prefixModuleIds: [] as string[],
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
    .filter(
      (v: Record<string, unknown>) =>
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
      return h(
        NTag,
        {
          type: (statusColors[row.status as string] || 'default') as
            | 'success'
            | 'info'
            | 'warning'
            | 'error'
            | 'default',
          size: 'small'
        },
        {
          default: () => t(`batch.status.${row.status}`)
        }
      )
    }
  },
  {
    title: t('batch.column.progress'),
    key: 'progress',
    width: 150,
    render(row) {
      return `${row.completed_tasks ?? 0}/${row.total_tasks ?? 0}`
    }
  },
  { title: t('batch.column.createdAt'), key: 'created_at', width: 180 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 300,
    render(row) {
      return h(
        NSpace,
        { size: 'small' },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'tiny',
                quaternary: true,
                type: 'default',
                onClick: () => handleEditJob(row)
              },
              {
                default: () => t('batch.actions.edit')
              }
            ),
            h(
              NButton,
              {
                size: 'tiny',
                quaternary: true,
                type: 'warning',
                onClick: () => handleRerunJob(row)
              },
              {
                default: () => t('batch.actions.rerun')
              }
            ),
            h(
              NButton,
              { size: 'tiny', quaternary: true, type: 'info', onClick: () => handleCloneJob(row) },
              {
                default: () => t('batch.actions.clone')
              }
            ),
            h(
              NButton,
              {
                size: 'tiny',
                quaternary: true,
                type: 'error',
                onClick: () => handleDeleteJob(row.id as string)
              },
              {
                default: () => t('common.delete')
              }
            )
          ]
        }
      )
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
  message.success(t('batch.msg.deleted'))
}

async function openBuilder(): Promise<void> {
  editingJobId.value = null
  await moduleStore.loadModules()
  await workflowStore.loadWorkflows()
  availableModules.value = moduleStore.modules
  moduleSelections.value = []
  variableOverrides.value = []
  batchResources.value = null
  batchName.value = ''
  batchDescription.value = ''
  selectedWorkflowId.value =
    workflowOptions.value.length > 0 ? workflowOptions.value[0].value : null
  showBuilderModal.value = true
}

async function addModuleToMatrix(moduleId: string): Promise<void> {
  await addModuleToMatrixShared(
    moduleId,
    moduleSelections,
    availableModules,
    moduleStore,
    moduleToAdd
  )
}

function removeModuleFromMatrix(moduleId: string): void {
  moduleSelections.value = moduleSelections.value.filter((s) => s.moduleId !== moduleId)
}

async function handleCreateBatch(): Promise<void> {
  if (!batchName.value) {
    message.warning(t('batch.msg.nameRequired'))
    return
  }
  if (!selectedWorkflowId.value) {
    message.warning(t('batch.msg.workflowRequired'))
    return
  }
  if (taskPreview.value.totalTasks === 0) {
    message.warning(t('batch.msg.itemsRequired'))
    return
  }

  try {
    // If editing, delete old job and its tasks first
    if (editingJobId.value) {
      await window.electron.ipcRenderer.invoke('batch:delete-tasks', { jobId: editingJobId.value })
      await window.electron.ipcRenderer.invoke('batch:delete', { id: editingJobId.value })
    }

    const result = await window.electron.ipcRenderer.invoke(
      'batch:create',
      toPlain({
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
          prefixModuleIds: s.prefixModuleIds,
          prefixText: s.prefixText,
          suffixText: s.suffixText
        })),
        variableOverrides: variableOverrides.value
          .filter((vo) => vo.enabled)
          .map((vo) => ({
            nodeId: vo.nodeId,
            fieldName: vo.fieldName,
            value: vo.value
          }))
      })
    )

    const isEdit = editingJobId.value !== null
    editingJobId.value = null
    message.success(
      isEdit
        ? t('batch.msg.editSuccess', { count: result.totalTasks })
        : t('batch.msg.createSuccess', { count: result.totalTasks })
    )
    showBuilderModal.value = false
    await loadBatchJobs()
  } catch (error) {
    message.error(
      editingJobId.value
        ? t('batch.msg.editFailed', { error: (error as Error).message })
        : t('batch.msg.createFailed', { error: (error as Error).message })
    )
  }
}

async function handleEditJob(job: Record<string, unknown>): Promise<void> {
  try {
    const config = JSON.parse(job.config as string)
    await moduleStore.loadModules()
    await workflowStore.loadWorkflows()
    availableModules.value = moduleStore.modules

    editingJobId.value = job.id as string

    // Restore basic settings (same as clone but without "(복사)" suffix)
    batchName.value = job.name as string
    batchDescription.value = config.description || ''
    selectedWorkflowId.value = config.workflowId || null
    countPerCombination.value = config.countPerCombination || 1
    seedMode.value = config.seedMode || 'random'
    fixedSeed.value = config.fixedSeed || 42
    outputPattern.value = config.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
    filePattern.value = config.fileNamePattern || '{character}_{outfit}_{emotion}_{index}'

    // Restore module selections
    await restoreModuleSelections(config, moduleSelections, availableModules, moduleStore)

    showBuilderModal.value = true

    // Restore slot mapping actions after watcher runs
    restoreSlotMappings(config.slotMappings, slotMappings)

    // Restore variable overrides after watcher runs
    restoreVariableOverrides(config.variableOverrides, variableOverrides)
  } catch (e) {
    message.error(t('batch.msg.editFailed', { error: e instanceof Error ? e.message : String(e) }))
  }
}

async function handleRerunJob(job: Record<string, unknown>): Promise<void> {
  try {
    const result = await window.electron.ipcRenderer.invoke('batch:rerun', { id: job.id as string })
    if (result.success) {
      message.success(t('batch.msg.rerunStarted'))
      await loadBatchJobs()
    } else {
      message.error(t('batch.msg.rerunFailed', { error: result.error }))
    }
  } catch (e) {
    message.error(t('batch.msg.rerunFailed', { error: e instanceof Error ? e.message : String(e) }))
  }
}

async function handleCloneJob(job: Record<string, unknown>): Promise<void> {
  try {
    const config = JSON.parse(job.config as string)
    await moduleStore.loadModules()
    await workflowStore.loadWorkflows()
    availableModules.value = moduleStore.modules

    // Restore basic settings
    batchName.value = `${job.name as string} ${t('batch.copySuffix')}`
    batchDescription.value = config.description || ''
    selectedWorkflowId.value = config.workflowId || null
    countPerCombination.value = config.countPerCombination || 1
    seedMode.value = config.seedMode || 'random'
    fixedSeed.value = config.fixedSeed || 42
    outputPattern.value = config.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
    filePattern.value = config.fileNamePattern || '{character}_{outfit}_{emotion}_{index}'

    // Restore module selections
    await restoreModuleSelections(config, moduleSelections, availableModules, moduleStore)

    showBuilderModal.value = true

    // Restore slot mapping actions after watcher runs
    restoreSlotMappings(config.slotMappings, slotMappings)

    // Restore variable overrides after watcher runs
    restoreVariableOverrides(config.variableOverrides, variableOverrides)

    message.info(t('batch.msg.cloneRestored'))
  } catch (e) {
    message.error(t('batch.msg.cloneFailed', { error: e instanceof Error ? e.message : String(e) }))
  }
}

watch(showBuilderModal, (val) => {
  if (!val) {
    editingJobId.value = null
  }
})

onMounted(() => {
  loadBatchJobs()
})
</script>

<template>
  <div class="batch-view">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h2>{{ t('batch.title') }}</h2>
      <NButton type="primary" @click="openBuilder">
        {{ t('batch.create') }}
      </NButton>
    </div>

    <NCard style="margin-top: 16px">
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
      style="width: 900px; max-height: 85vh"
      :title="editingJobId ? t('batch.wizard.editTitle') : t('batch.builder')"
      :bordered="false"
    >
      <NScrollbar style="max-height: 70vh">
        <NForm label-placement="left" :label-width="140">
          <!-- Basic info -->
          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('common.name')">
                <NInput
                  v-model:value="batchName"
                  :placeholder="t('batch.wizard.namePlaceholder')"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('batch.wizard.workflowLabel')">
                <NSelect
                  v-model:value="selectedWorkflowId"
                  :options="workflowOptions"
                  :placeholder="t('batch.wizard.workflowPlaceholder')"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NFormItem :label="t('common.description')">
            <NInput
              v-model:value="batchDescription"
              :placeholder="t('batch.wizard.descriptionPlaceholder')"
            />
          </NFormItem>

          <NDivider>{{ t('batch.wizard.moduleSection') }}</NDivider>

          <!-- Module selection -->
          <NFormItem :label="t('batch.wizard.addModuleLabel')">
            <NSelect
              v-model:value="moduleToAdd"
              :placeholder="t('batch.wizard.addModulePlaceholder')"
              :options="
                availableModules
                  .filter((m) => !moduleSelections.some((s) => s.moduleId === m.id))
                  .map((m) => ({ label: `${m.name} (${t('module.type.' + m.type)})`, value: m.id }))
              "
              @update:value="addModuleToMatrix"
            />
          </NFormItem>

          <!-- Selected modules with item checkboxes -->
          <template v-for="sel in moduleSelections" :key="sel.moduleId">
            <NCard size="small" style="margin-bottom: 12px">
              <template #header>
                <NSpace align="center">
                  <NTag size="small">{{ t('module.type.' + sel.moduleType) }}</NTag>
                  <span>{{ sel.moduleName }}</span>
                  <NTag size="tiny" round
                    >{{ sel.selectedItemIds.length }}/{{ sel.items.length }}</NTag
                  >
                </NSpace>
              </template>
              <template #header-extra>
                <NSpace :size="4">
                  <NButton
                    size="tiny"
                    quaternary
                    @click="sel.selectedItemIds = sel.items.map((i) => i.id)"
                    >{{ t('batch.wizard.selectAll') }}</NButton
                  >
                  <NButton size="tiny" quaternary @click="sel.selectedItemIds = []">{{
                    t('batch.wizard.deselectAll')
                  }}</NButton>
                  <NButton
                    size="tiny"
                    quaternary
                    type="error"
                    @click="removeModuleFromMatrix(sel.moduleId)"
                    >{{ t('batch.wizard.remove') }}</NButton
                  >
                </NSpace>
              </template>
              <NCheckboxGroup v-model:value="sel.selectedItemIds">
                <NSpace>
                  <NCheckbox
                    v-for="item in sel.items"
                    :key="item.id"
                    :value="item.id"
                    :label="item.name"
                  />
                </NSpace>
              </NCheckboxGroup>
              <NAlert
                v-if="sel.items.length === 0"
                type="warning"
                style="margin-top: 8px; font-size: 12px"
              >
                {{ t('batch.wizard.noItems') }}
              </NAlert>
            </NCard>
          </template>

          <NDivider>{{ t('batch.wizard.slotSection') }}</NDivider>

          <NAlert
            v-if="slotMappings.length === 0"
            type="info"
            style="margin-bottom: 12px; font-size: 12px"
          >
            {{ t('batch.wizard.noSlots') }}
          </NAlert>
          <template v-for="slot in slotMappings" :key="slot.variableId">
            <NCard size="small" style="margin-bottom: 8px">
              <NSpace align="center" justify="space-between">
                <NSpace align="center">
                  <NTag size="small" :type="slot.role === 'prompt_positive' ? 'success' : 'error'">
                    {{
                      slot.role === 'prompt_positive'
                        ? t('batch.wizard.positive')
                        : t('batch.wizard.negative')
                    }}
                  </NTag>
                  <span>{{ slot.displayName }}</span>
                </NSpace>
                <NSelect
                  v-model:value="slot.action"
                  :options="[
                    { label: t('batch.wizard.actionInject'), value: 'inject' },
                    { label: t('batch.wizard.actionFixed'), value: 'fixed' }
                  ]"
                  size="small"
                  style="width: 180px"
                />
              </NSpace>

              <!-- Fixed value mode -->
              <NInput
                v-if="slot.action === 'fixed'"
                v-model:value="slot.fixedValue"
                type="textarea"
                :rows="2"
                :placeholder="t('batch.wizard.fixedPlaceholder')"
                style="margin-top: 8px"
              />

              <!-- Inject mode with per-slot module control -->
              <template v-if="slot.action === 'inject'">
                <!-- Fixed (prefix) modules -->
                <div style="margin-top: 8px">
                  <span style="font-size: 12px; opacity: 0.7; margin-bottom: 4px; display: block">{{
                    t('batch.wizard.prefixModules')
                  }}</span>
                  <NSelect
                    v-model:value="slot.prefixModuleIds"
                    multiple
                    filterable
                    :placeholder="t('batch.wizard.prefixModulePlaceholder')"
                    size="small"
                    :options="
                      availableModules.map((m) => ({
                        label: `${m.name} (${t('module.type.' + m.type)})`,
                        value: m.id
                      }))
                    "
                  />
                </div>

                <!-- Manual prefix text -->
                <NInput
                  v-model:value="slot.prefixText"
                  type="textarea"
                  :rows="2"
                  :placeholder="t('batch.wizard.prefixTextPlaceholder')"
                  size="small"
                  style="margin-top: 8px"
                />

                <!-- Matrix module assignment -->
                <div v-if="moduleSelections.length > 0" style="margin-top: 8px">
                  <span style="font-size: 12px; opacity: 0.7; margin-bottom: 4px; display: block">{{
                    t('batch.wizard.matrixModules')
                  }}</span>
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
                <NAlert v-else type="info" style="margin-top: 8px; font-size: 12px">
                  {{ t('batch.wizard.noModulesHint') }}
                </NAlert>

                <!-- Suffix text -->
                <NInput
                  v-model:value="slot.suffixText"
                  type="textarea"
                  :rows="2"
                  :placeholder="t('batch.wizard.suffixPlaceholder')"
                  size="small"
                  style="margin-top: 8px"
                />
              </template>
            </NCard>
          </template>

          <NDivider>{{ t('batch.wizard.overrideSection') }}</NDivider>

          <NAlert
            v-if="variableOverrides.length === 0"
            type="info"
            style="margin-bottom: 12px; font-size: 12px"
          >
            {{ t('batch.wizard.noOverrides') }}
          </NAlert>

          <template v-for="vo in variableOverrides" :key="vo.variableId">
            <NCard size="small" style="margin-bottom: 8px">
              <NSpace align="center" justify="space-between">
                <NSpace align="center">
                  <NSwitch v-model:value="vo.enabled" size="small" />
                  <NTag
                    size="small"
                    :type="
                      vo.varType === 'model'
                        ? 'success'
                        : vo.varType === 'lora'
                          ? 'warning'
                          : 'default'
                    "
                  >
                    {{ varTypeLabels[vo.varType] || vo.varType }}
                  </NTag>
                  <span :style="{ opacity: vo.enabled ? 1 : 0.5 }">{{ vo.displayName }}</span>
                </NSpace>
                <span v-if="!vo.enabled" style="font-size: 12px; opacity: 0.5">{{
                  vo.defaultValue
                    ? t('batch.wizard.defaultValue', { value: vo.defaultValue })
                    : t('batch.wizard.defaultValueNone')
                }}</span>
              </NSpace>

              <template v-if="vo.enabled">
                <div style="margin-top: 8px">
                  <!-- Model dropdown -->
                  <NSelect
                    v-if="vo.varType === 'model'"
                    v-model:value="vo.value"
                    :options="
                      (batchResources?.checkpoints || []).map((c) => ({ label: c, value: c }))
                    "
                    :placeholder="t('batch.wizard.checkpointPlaceholder')"
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <!-- LoRA dropdown -->
                  <NSelect
                    v-else-if="vo.varType === 'lora'"
                    v-model:value="vo.value"
                    :options="(batchResources?.loras || []).map((l) => ({ label: l, value: l }))"
                    :placeholder="t('batch.wizard.loraPlaceholder')"
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <!-- LoRA weights -->
                  <NSpace
                    v-else-if="
                      vo.varType === 'number' &&
                      (vo.fieldName === 'strength_model' || vo.fieldName === 'strength_clip')
                    "
                    align="center"
                  >
                    <NSlider
                      :value="Number(vo.value) || 1"
                      :min="0"
                      :max="2"
                      :step="0.05"
                      style="width: 200px"
                      @update:value="
                        (v: number) => {
                          vo.value = String(v)
                        }
                      "
                    />
                    <NInputNumber
                      :value="Number(vo.value) || 1"
                      :min="0"
                      :max="2"
                      :step="0.05"
                      size="small"
                      style="width: 100px"
                      @update:value="
                        (v: number | null) => {
                          vo.value = String(v ?? 1)
                        }
                      "
                    />
                  </NSpace>
                  <!-- Sampler/Scheduler dropdowns -->
                  <NSelect
                    v-else-if="vo.fieldName === 'sampler_name'"
                    v-model:value="vo.value"
                    :options="(batchResources?.samplers || []).map((s) => ({ label: s, value: s }))"
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <NSelect
                    v-else-if="vo.fieldName === 'scheduler'"
                    v-model:value="vo.value"
                    :options="
                      (batchResources?.schedulers || []).map((s) => ({ label: s, value: s }))
                    "
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <!-- Number -->
                  <NInputNumber
                    v-else-if="vo.varType === 'number'"
                    :value="Number(vo.value) || 0"
                    size="small"
                    style="width: 200px"
                    @update:value="
                      (v: number | null) => {
                        vo.value = String(v ?? 0)
                      }
                    "
                  />
                  <!-- Text -->
                  <NInput
                    v-else
                    v-model:value="vo.value"
                    type="textarea"
                    :rows="2"
                    size="small"
                    :placeholder="t('batch.wizard.overrideValuePlaceholder')"
                  />
                </div>
              </template>
            </NCard>
          </template>

          <NDivider>{{ t('batch.wizard.generationSettings') }}</NDivider>

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
              <NFormItem :label="t('batch.wizard.seedValue')">
                <NInputNumber v-model:value="fixedSeed" :min="0" :max="2147483647" />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NDivider>{{ t('batch.wizard.outputSettings') }}</NDivider>

          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('batch.wizard.folderPattern')">
                <NInput
                  v-model:value="outputPattern"
                  placeholder="{job}/{character}/{outfit}/{emotion}"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('batch.wizard.filePattern')">
                <NInput
                  v-model:value="filePattern"
                  placeholder="{character}_{outfit}_{emotion}_{index}"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NAlert type="info" style="margin-top: 8px; font-size: 12px">
            {{ t('batch.wizard.availableVars', { lbrace: '{', rbrace: '}' }) }}
          </NAlert>

          <!-- Preview Stats -->
          <NDivider>{{ t('batch.wizard.preview') }}</NDivider>
          <NGrid :cols="3" :x-gap="16">
            <NGridItem>
              <NStatistic
                :label="t('batch.wizard.moduleDimensions')"
                :value="moduleSelections.filter((s) => s.selectedItemIds.length > 0).length"
              />
            </NGridItem>
            <NGridItem>
              <NStatistic
                :label="t('batch.wizard.totalCombinations')"
                :value="taskPreview.totalCombinations"
              />
            </NGridItem>
            <NGridItem>
              <NStatistic :label="t('batch.wizard.totalImages')" :value="taskPreview.totalTasks" />
            </NGridItem>
          </NGrid>

          <NAlert
            v-if="taskPreview.totalTasks === 0 && moduleSelections.length > 0"
            type="info"
            style="margin-top: 12px; font-size: 12px"
          >
            {{ t('batch.wizard.needItems') }}
          </NAlert>

          <NAlert
            v-if="moduleSelections.length === 0"
            type="info"
            style="margin-top: 12px; font-size: 12px"
          >
            {{ t('batch.wizard.addModulesHint') }}
          </NAlert>

          <NAlert v-if="taskPreview.totalTasks > 10000" type="warning" style="margin-top: 12px">
            {{
              t('batch.wizard.tooManyWarning', { count: taskPreview.totalTasks.toLocaleString() })
            }}
          </NAlert>
        </NForm>
      </NScrollbar>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showBuilderModal = false">{{ t('common.cancel') }}</NButton>
          <NButton
            type="primary"
            :disabled="taskPreview.totalTasks === 0"
            @click="handleCreateBatch"
          >
            {{ editingJobId ? t('batch.wizard.submitEdit') : t('batch.wizard.submitCreate') }}
            {{ t('batch.wizard.submitCount', { count: taskPreview.totalTasks.toLocaleString() }) }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
