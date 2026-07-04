<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NModal, NScrollbar, NSpace, NStep, NSteps, useMessage } from 'naive-ui'
import { useModuleStore, type PromptModule } from '@renderer/stores/module.store'
import { useWorkflowStore } from '@renderer/stores/workflow.store'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { isJsonObject, safeJsonParse } from '@renderer/utils/safe-json'
import {
  restoreModuleSelections,
  restoreSlotMappings,
  restoreVariableOverrides
} from '@renderer/composables/useBatchWizard'
import {
  buildBatchSeedModeOptions,
  buildWorkflowVarTypeLabels,
  getGenerationWorkflowHint
} from '@renderer/utils/view-labels'
import WizardStepWorkflow from './WizardStepWorkflow.vue'
import WizardStepModules from './WizardStepModules.vue'
import WizardStepConfirm from './WizardStepConfirm.vue'
import type {
  BatchResources,
  BatchWizardMode,
  ModuleSelectionUI,
  RestorableJobConfig,
  SeedMode,
  SlotMapping,
  VariableOverride
} from './types'

const props = defineProps<{
  show: boolean
  mode: BatchWizardMode
  sourceJob: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const { t } = useI18n()
const message = useMessage()
const moduleStore = useModuleStore()
const workflowStore = useWorkflowStore()
const currentStep = ref(1)
const editingJobId = ref<string | null>(null)
const batchName = ref('')
const batchDescription = ref('')
const selectedWorkflowId = ref<string | null>(null)
const countPerCombination = ref(1)
const seedMode = ref<SeedMode>('random')
const fixedSeed = ref(42)
const moduleSelections = ref<ModuleSelectionUI[]>([])
const availableModules = ref<PromptModule[]>([])
const moduleToAdd = ref<string | null>(null)
const slotMappings = ref<SlotMapping[]>([])
const variableOverrides = ref<VariableOverride[]>([])
const showOverrides = ref(false)
const batchResources = ref<BatchResources | null>(null)
const outputPattern = ref('{job}/{character}/{outfit}/{emotion}')
const filePattern = ref('{character}_{outfit}_{emotion}_{index}')

const showWizard = computed({
  get: () => props.show,
  set: (value: boolean) => emit('update:show', value)
})
const workflowOptions = computed(() =>
  workflowStore.workflows
    .filter((workflow) => workflow.category === 'generation')
    .map((workflow) => ({ label: workflow.name, value: workflow.id }))
)
const generationWorkflowHint = computed(() => getGenerationWorkflowHint(workflowStore.workflows, t))
const seedModeOptions = computed(() => buildBatchSeedModeOptions(t))
const varTypeLabels = computed(() => buildWorkflowVarTypeLabels(t))
const taskPreview = computed(() => {
  const selections = moduleSelections.value.filter(
    (selection) => selection.selectedItemIds.length > 0
  )
  if (selections.length === 0) return { totalCombinations: 0, totalTasks: 0 }
  const totalCombinations = selections.reduce(
    (total, selection) => total * selection.selectedItemIds.length,
    1
  )
  return {
    totalCombinations,
    totalTasks: totalCombinations * countPerCombination.value
  }
})
const canGoStep2 = computed(() => Boolean(batchName.value && selectedWorkflowId.value))
const canGoStep3 = computed(() => taskPreview.value.totalTasks > 0)

function isRestorableJobConfig(value: unknown): value is RestorableJobConfig {
  return (
    isJsonObject(value) &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.workflowId === undefined ||
      value.workflowId === null ||
      typeof value.workflowId === 'string') &&
    (value.countPerCombination === undefined || typeof value.countPerCombination === 'number') &&
    (value.seedMode === undefined ||
      value.seedMode === 'random' ||
      value.seedMode === 'fixed' ||
      value.seedMode === 'incremental') &&
    (value.fixedSeed === undefined || typeof value.fixedSeed === 'number') &&
    (value.outputFolderPattern === undefined || typeof value.outputFolderPattern === 'string') &&
    (value.fileNamePattern === undefined || typeof value.fileNamePattern === 'string') &&
    (value.moduleSelections === undefined || Array.isArray(value.moduleSelections)) &&
    (value.slotMappings === undefined || Array.isArray(value.slotMappings)) &&
    (value.variableOverrides === undefined || Array.isArray(value.variableOverrides))
  )
}

async function loadWorkflowVariables(workflowId: string): Promise<void> {
  const variables = await invokeIpc(IPC_CHANNELS.WORKFLOW_VARIABLES, { workflowId })
  slotMappings.value = variables
    .filter(
      (variable) => variable.role === 'prompt_positive' || variable.role === 'prompt_negative'
    )
    .map((variable) => ({
      variableId: variable.id,
      nodeId: variable.node_id,
      fieldName: variable.field_name,
      displayName: variable.display_name,
      role: variable.role,
      action: 'inject',
      fixedValue: variable.default_val || '',
      assignedModuleIds: [],
      prefixModuleIds: [],
      prefixText: '',
      suffixText: '',
      promptVariant: ''
    }))

  try {
    batchResources.value = await invokeIpc(IPC_CHANNELS.COMFYUI_MODELS)
  } catch (error) {
    void error
    batchResources.value = null
  }

  variableOverrides.value = variables
    .filter(
      (variable) =>
        variable.role !== 'prompt_positive' &&
        variable.role !== 'prompt_negative' &&
        variable.var_type !== 'seed'
    )
    .map((variable) => ({
      variableId: variable.id,
      nodeId: variable.node_id,
      fieldName: variable.field_name,
      displayName: variable.display_name,
      varType: variable.var_type,
      role: variable.role,
      enabled: false,
      value: variable.default_val || '',
      defaultValue: variable.default_val || ''
    }))
}

watch(selectedWorkflowId, async (workflowId) => {
  if (!workflowId) {
    slotMappings.value = []
    variableOverrides.value = []
    return
  }
  await loadWorkflowVariables(workflowId)
})

async function loadWizardSources(): Promise<void> {
  await moduleStore.loadModules()
  await workflowStore.loadWorkflows()
  availableModules.value = moduleStore.modules
}

async function initializeCreate(): Promise<void> {
  editingJobId.value = null
  currentStep.value = 1
  await loadWizardSources()
  moduleSelections.value = []
  variableOverrides.value = []
  batchResources.value = null
  batchName.value = ''
  batchDescription.value = ''
  countPerCombination.value = 1
  seedMode.value = 'random'
  fixedSeed.value = 42
  outputPattern.value = '{job}/{character}/{outfit}/{emotion}'
  filePattern.value = '{character}_{outfit}_{emotion}_{index}'
  showOverrides.value = false
  selectedWorkflowId.value = workflowOptions.value[0]?.value ?? null
}

async function initializeFromJob(job: Record<string, unknown>, clone: boolean): Promise<void> {
  const parsedConfig = safeJsonParse<RestorableJobConfig>(job.config as string, {
    context: 'Batch job config',
    validate: isRestorableJobConfig,
    invalidShapeMessage: 'Batch job config has an invalid shape'
  })
  if (!parsedConfig.ok) throw new Error(parsedConfig.error)

  const config = parsedConfig.value
  await loadWizardSources()
  currentStep.value = 1
  editingJobId.value = clone ? null : (job.id as string)
  batchName.value = clone ? `${job.name as string} ${t('batch.copySuffix')}` : (job.name as string)
  batchDescription.value = config.description || ''
  selectedWorkflowId.value = config.workflowId || null
  countPerCombination.value = config.countPerCombination || 1
  seedMode.value = config.seedMode || 'random'
  fixedSeed.value = config.fixedSeed || 42
  outputPattern.value = config.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
  filePattern.value = config.fileNamePattern || '{character}_{outfit}_{emotion}_{index}'

  await restoreModuleSelections(config, moduleSelections, availableModules, moduleStore)
  restoreSlotMappings(config.slotMappings, slotMappings, { useUserPrefixText: true })
  restoreVariableOverrides(config.variableOverrides, variableOverrides, showOverrides)
}

async function initializeWizard(): Promise<void> {
  try {
    if (props.mode === 'create') {
      await initializeCreate()
    } else if (props.sourceJob) {
      await initializeFromJob(props.sourceJob, props.mode === 'clone')
    }
  } catch (error) {
    message.error(
      t('batch.msg.restoreFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
    showWizard.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) void initializeWizard()
  },
  { immediate: true }
)

async function handleCreateBatch(): Promise<void> {
  if (!batchName.value || !selectedWorkflowId.value || taskPreview.value.totalTasks === 0) return

  try {
    if (editingJobId.value) {
      await invokeIpc(IPC_CHANNELS.BATCH_DELETE_TASKS, { jobId: editingJobId.value })
      await invokeIpc(IPC_CHANNELS.BATCH_DELETE, { id: editingJobId.value })
    }

    const result = await invokeIpc(IPC_CHANNELS.BATCH_CREATE, {
      name: batchName.value,
      description: batchDescription.value,
      workflowId: selectedWorkflowId.value,
      moduleSelections: moduleSelections.value.map((selection) => ({
        moduleId: selection.moduleId,
        moduleType: selection.moduleType,
        selectedItemIds: selection.selectedItemIds
      })),
      countPerCombination: countPerCombination.value,
      seedMode: seedMode.value,
      fixedSeed: fixedSeed.value,
      outputFolderPattern: outputPattern.value,
      fileNamePattern: filePattern.value,
      slotMappings: slotMappings.value.map((slot) => ({
        variableId: slot.variableId,
        nodeId: slot.nodeId,
        fieldName: slot.fieldName,
        role: slot.role,
        action: slot.action,
        fixedValue: slot.fixedValue,
        assignedModuleIds: slot.assignedModuleIds,
        prefixModuleIds: slot.prefixModuleIds,
        prefixText: slot.prefixText,
        suffixText: slot.suffixText,
        promptVariant: slot.promptVariant
      })),
      variableOverrides: variableOverrides.value
        .filter((variable) => variable.enabled)
        .map((variable) => ({
          nodeId: variable.nodeId,
          fieldName: variable.fieldName,
          value: variable.value
        }))
    })

    const wasEdit = editingJobId.value !== null
    message.success(
      wasEdit
        ? t('batch.msg.editSuccess', { count: result.totalTasks })
        : t('batch.msg.createSuccess', { count: result.totalTasks })
    )
    editingJobId.value = null
    showWizard.value = false
    emit('saved')
  } catch (error) {
    message.error(
      t('batch.msg.jobCreateFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
  }
}
</script>

<template>
  <NModal
    v-model:show="showWizard"
    preset="card"
    style="width: 900px; max-height: 90vh"
    :title="editingJobId ? t('batch.wizard.editTitle') : t('batch.wizard.createTitle')"
    :bordered="false"
  >
    <NSteps :current="currentStep" size="small" style="margin-bottom: 20px">
      <NStep :title="t('batch.wizard.stepBasic')" />
      <NStep :title="t('batch.wizard.stepModules')" />
      <NStep :title="t('batch.wizard.stepConfirm')" />
    </NSteps>

    <NScrollbar style="max-height: calc(90vh - 200px)">
      <WizardStepWorkflow
        v-show="currentStep === 1"
        v-model:batch-name="batchName"
        v-model:selected-workflow-id="selectedWorkflowId"
        v-model:batch-description="batchDescription"
        v-model:count-per-combination="countPerCombination"
        v-model:seed-mode="seedMode"
        v-model:fixed-seed="fixedSeed"
        :workflow-options="workflowOptions"
        :generation-workflow-hint="generationWorkflowHint"
        :seed-mode-options="seedModeOptions"
      />
      <WizardStepModules
        v-show="currentStep === 2"
        v-model:module-selections="moduleSelections"
        v-model:module-to-add="moduleToAdd"
        v-model:slot-mappings="slotMappings"
        :available-modules="availableModules"
      />
      <WizardStepConfirm
        v-show="currentStep === 3"
        v-model:variable-overrides="variableOverrides"
        v-model:show-overrides="showOverrides"
        v-model:output-pattern="outputPattern"
        v-model:file-pattern="filePattern"
        :module-selections="moduleSelections"
        :task-preview="taskPreview"
        :batch-resources="batchResources"
        :var-type-labels="varTypeLabels"
      />
    </NScrollbar>

    <template #footer>
      <NSpace justify="space-between">
        <NButton v-if="currentStep > 1" @click="currentStep--">
          {{ t('batch.wizard.prev') }}
        </NButton>
        <div v-else />
        <NSpace>
          <NButton @click="showWizard = false">{{ t('common.cancel') }}</NButton>
          <NButton
            v-if="currentStep < 3"
            type="primary"
            :disabled="currentStep === 1 ? !canGoStep2 : !canGoStep3"
            @click="currentStep++"
          >
            {{ t('batch.wizard.next') }}
          </NButton>
          <NButton
            v-else
            type="primary"
            :disabled="taskPreview.totalTasks === 0"
            @click="handleCreateBatch"
          >
            {{ editingJobId ? t('batch.wizard.submitEdit') : t('batch.wizard.submitCreate') }}
            {{ t('batch.wizard.submitCount', { count: taskPreview.totalTasks.toLocaleString() }) }}
          </NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>
</template>
