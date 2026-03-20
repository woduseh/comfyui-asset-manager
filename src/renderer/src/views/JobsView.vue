<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
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
  NGrid,
  NGridItem,
  NSteps,
  NStep,
  NCheckboxGroup,
  NCheckbox,
  NAlert,
  NScrollbar,
  NSwitch,
  NSlider,
  NProgress,
  NStatistic,
  useMessage
} from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import { useModuleStore, type PromptModule, type ModuleItem } from '@renderer/stores/module.store'
import { useWorkflowStore } from '@renderer/stores/workflow.store'
import { useConnectionStore } from '@renderer/stores/connection.store'
import { useQueueStore } from '@renderer/stores/queue.store'
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
const connectionStore = useConnectionStore()
const queueStore = useQueueStore()

// ─── Job list ───
const batchJobs = ref<Record<string, unknown>[]>([])
const loadingJobs = ref(false)
const queueStatus = ref<{ isProcessing: boolean; isPaused: boolean; currentJobId: string | null }>({
  isProcessing: false,
  isPaused: false,
  currentJobId: null
})
let refreshInterval: ReturnType<typeof setInterval> | null = null

// ─── Wizard state ───
const showWizard = ref(false)
const currentStep = ref(1)
const editingJobId = ref<string | null>(null)

// Step 1: Basic settings
const batchName = ref('')
const batchDescription = ref('')
const selectedWorkflowId = ref<string | null>(null)
const countPerCombination = ref(1)
const seedMode = ref<'random' | 'fixed' | 'incremental'>('random')
const fixedSeed = ref(42)

// Step 2: Modules & Prompts
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
  promptVariant: string
}
const slotMappings = ref<SlotMapping[]>([])

// Step 3: Overrides & Output
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
const showOverrides = ref(false)
const batchResources = ref<{
  checkpoints: string[]
  loras: string[]
  vaes: string[]
  upscaleModels: string[]
  samplers: string[]
  schedulers: string[]
} | null>(null)
const outputPattern = ref('{job}/{character}/{outfit}/{emotion}')
const filePattern = ref('{character}_{outfit}_{emotion}_{index}')

const varTypeLabels: Record<string, string> = {
  text: t('workflow.varType.text'),
  number: t('workflow.varType.number'),
  boolean: t('workflow.varType.boolean'),
  seed: t('workflow.varType.seed'),
  image: t('workflow.varType.image'),
  model: t('workflow.varType.model'),
  lora: t('workflow.varType.lora')
}

const statusLabels: Record<string, string> = {
  draft: t('jobs.statusLabel.draft'),
  queued: t('jobs.statusLabel.queued'),
  running: t('jobs.statusLabel.running'),
  paused: t('jobs.statusLabel.paused'),
  completed: t('jobs.statusLabel.completed'),
  failed: t('jobs.statusLabel.failed'),
  cancelled: t('jobs.statusLabel.cancelled')
}

const statusColors: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  queued: 'info',
  running: 'warning',
  paused: 'default',
  completed: 'success',
  failed: 'error',
  cancelled: 'default'
}

// ─── Computed ───
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

const taskPreview = computed(() => {
  const selections = moduleSelections.value.filter((s) => s.selectedItemIds.length > 0)
  if (selections.length === 0) return { totalCombinations: 0, totalTasks: 0 }
  let totalCombinations = 1
  for (const sel of selections) totalCombinations *= sel.selectedItemIds.length
  return { totalCombinations, totalTasks: totalCombinations * countPerCombination.value }
})

const runningJob = computed(() => {
  return batchJobs.value.find((j) => j.status === 'running' || j.status === 'paused') || null
})

const runningJobEta = computed(() => {
  if (!runningJob.value) return null
  const jobId = runningJob.value.id as string
  const queueJob = queueStore.activeJobs.find((j) => j.id === jobId)
  if (!queueJob?.etaMs || queueJob.etaMs <= 0) return null

  const totalSec = Math.ceil(queueJob.etaMs / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  if (hours > 0) return t('jobs.time.hours', { hours, mins })
  if (mins > 0) return t('jobs.time.minutes', { mins, secs })
  return t('jobs.time.seconds', { secs })
})

const canGoStep2 = computed(() => !!batchName.value && !!selectedWorkflowId.value)
const canGoStep3 = computed(() => taskPreview.value.totalTasks > 0)

// ─── Load workflow variables ───
async function loadWorkflowVariables(workflowId: string): Promise<void> {
  const variables = await window.electron.ipcRenderer.invoke('workflow:variables', { workflowId })
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
      suffixText: '',
      promptVariant: ''
    }))

  try {
    batchResources.value = await window.electron.ipcRenderer.invoke('comfyui:models')
  } catch {
    batchResources.value = null
  }

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
}

watch(selectedWorkflowId, async (id) => {
  if (!id) {
    slotMappings.value = []
    variableOverrides.value = []
    return
  }
  await loadWorkflowVariables(id)
})

// ─── Data loading ───
async function loadBatchJobs(): Promise<void> {
  loadingJobs.value = true
  try {
    batchJobs.value = (await window.electron.ipcRenderer.invoke('batch:list')) || []
  } finally {
    loadingJobs.value = false
  }
}

async function loadQueueStatus(): Promise<void> {
  try {
    queueStatus.value = await window.electron.ipcRenderer.invoke('queue:status')
  } catch {
    /* ignore */
  }
}

async function handleReorderJobs(): Promise<void> {
  const jobIds = batchJobs.value.map((j) => j.id as string)
  await window.electron.ipcRenderer.invoke('batch:reorder', { jobIds })
}

function getModuleName(moduleId: string): string {
  const mod = availableModules.value.find((m) => m.id === moduleId)
  return mod ? mod.name : moduleId.slice(0, 8)
}

function removePrefixModule(slot: SlotMapping, moduleId: string): void {
  slot.prefixModuleIds = slot.prefixModuleIds.filter((id) => id !== moduleId)
}

function addPrefixModule(slot: SlotMapping, moduleId: string | null): void {
  if (!moduleId || slot.prefixModuleIds.includes(moduleId)) return
  slot.prefixModuleIds.push(moduleId)
}

// ─── Queue controls ───
async function handleStartJob(jobId: string): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('batch:start', { id: jobId })
  if (result.success) {
    message.success(t('batch.msg.started'))
  } else {
    message.error(t('batch.msg.startFailed', { error: result.error }))
    return
  }
  // Short delay for main process to update DB status to 'running'
  await new Promise((r) => setTimeout(r, 300))
  await loadBatchJobs()
  await loadQueueStatus()
  await queueStore.loadActiveJobs()
}

async function handlePause(): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:pause')
  message.info(t('batch.msg.paused'))
  await loadBatchJobs()
  await loadQueueStatus()
}

async function handleResume(): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:resume')
  message.info(t('batch.msg.resumed'))
  await loadBatchJobs()
  await loadQueueStatus()
}

async function handleCancel(): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:cancel')
  message.warning(t('batch.msg.cancelled'))
  await loadBatchJobs()
  await loadQueueStatus()
}

// ─── Job actions ───
async function handleDeleteJob(id: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('batch:delete', { id })
  await loadBatchJobs()
  message.success(t('batch.msg.deleted'))
}

async function handleRerunJob(job: Record<string, unknown>): Promise<void> {
  try {
    const result = await window.electron.ipcRenderer.invoke('batch:rerun', { id: job.id as string })
    if (result.success) {
      message.success(t('batch.msg.rerunStartedShort'))
    } else {
      message.error(t('batch.msg.rerunFailed', { error: result.error }))
      return
    }
    // Short delay for main process to update DB status
    await new Promise((r) => setTimeout(r, 300))
    await loadBatchJobs()
    await loadQueueStatus()
    await queueStore.loadActiveJobs()
  } catch (e) {
    message.error(t('batch.msg.rerunFailed', { error: e instanceof Error ? e.message : String(e) }))
  }
}

// ─── Wizard: open ───
async function openWizard(): Promise<void> {
  editingJobId.value = null
  currentStep.value = 1
  await moduleStore.loadModules()
  await workflowStore.loadWorkflows()
  availableModules.value = moduleStore.modules
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
  selectedWorkflowId.value =
    workflowOptions.value.length > 0 ? workflowOptions.value[0].value : null
  if (selectedWorkflowId.value) {
    await loadWorkflowVariables(selectedWorkflowId.value)
  }
  showWizard.value = true
}

// ─── Wizard: module operations ───
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

// ─── Wizard: create/save ───
async function handleCreateBatch(): Promise<void> {
  if (!batchName.value || !selectedWorkflowId.value || taskPreview.value.totalTasks === 0) return

  try {
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
          suffixText: s.suffixText,
          promptVariant: s.promptVariant
        })),
        variableOverrides: variableOverrides.value
          .filter((vo) => vo.enabled)
          .map((vo) => ({ nodeId: vo.nodeId, fieldName: vo.fieldName, value: vo.value }))
      })
    )

    const isEdit = editingJobId.value !== null
    editingJobId.value = null
    message.success(
      isEdit
        ? t('batch.msg.editSuccess', { count: result.totalTasks })
        : t('batch.msg.createSuccess', { count: result.totalTasks })
    )
    showWizard.value = false
    await loadBatchJobs()
  } catch (error) {
    message.error(t('batch.msg.jobCreateFailed', { error: (error as Error).message }))
  }
}

// ─── Wizard: edit/clone helpers ───
async function restoreConfig(job: Record<string, unknown>, isClone: boolean): Promise<void> {
  try {
    const config = JSON.parse(job.config as string)
    await moduleStore.loadModules()
    await workflowStore.loadWorkflows()
    availableModules.value = moduleStore.modules
    currentStep.value = 1

    editingJobId.value = isClone ? null : (job.id as string)
    batchName.value = isClone
      ? `${job.name as string} ${t('batch.copySuffix')}`
      : (job.name as string)
    batchDescription.value = config.description || ''
    selectedWorkflowId.value = config.workflowId || null
    countPerCombination.value = config.countPerCombination || 1
    seedMode.value = config.seedMode || 'random'
    fixedSeed.value = config.fixedSeed || 42
    outputPattern.value = config.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
    filePattern.value = config.fileNamePattern || '{character}_{outfit}_{emotion}_{index}'

    await restoreModuleSelections(config, moduleSelections, availableModules, moduleStore)

    showWizard.value = true

    restoreSlotMappings(config.slotMappings, slotMappings, { useUserPrefixText: true })
    restoreVariableOverrides(config.variableOverrides, variableOverrides, showOverrides)
  } catch (e) {
    message.error(
      t('batch.msg.restoreFailed', { error: e instanceof Error ? e.message : String(e) })
    )
  }
}

function handleEditJob(job: Record<string, unknown>): void {
  restoreConfig(job, false)
}
function handleCloneJob(job: Record<string, unknown>): void {
  restoreConfig(job, true)
}

watch(showWizard, (val) => {
  if (!val) editingJobId.value = null
})

function getJobProgress(job: Record<string, unknown>): number {
  const total = (job.total_tasks as number) || 0
  const completed = (job.completed_tasks as number) || 0
  return total > 0 ? Math.round((completed / total) * 100) : 0
}

onMounted(() => {
  loadBatchJobs()
  loadQueueStatus()
  refreshInterval = setInterval(async () => {
    if (queueStatus.value.isProcessing || runningJob.value) {
      await loadBatchJobs()
      await loadQueueStatus()
    }
  }, 3000)
})

// Auto-refresh job list when queueStore detects job completion
watch(
  () => queueStore.activeJobs.length,
  () => {
    loadBatchJobs()
    loadQueueStatus()
  }
)

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>

<template>
  <div>
    <div
      style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      "
    >
      <h2 style="margin: 0">{{ t('jobs.title') }}</h2>
      <NButton type="primary" @click="openWizard">
        {{ t('jobs.newBatch') }}
      </NButton>
    </div>

    <!-- Running job status bar -->
    <NCard v-if="runningJob" size="small" style="margin-bottom: 16px; border-radius: 12px">
      <NSpace align="center" justify="space-between">
        <NSpace align="center" :size="12">
          <NTag :type="queueStatus.isPaused ? 'default' : 'warning'" size="small" round>
            {{ queueStatus.isPaused ? t('queue.statusPaused') : t('queue.statusRunning') }}
          </NTag>
          <strong>{{ runningJob.name }}</strong>
          <span style="font-size: 13px; opacity: 0.6">
            {{ runningJob.completed_tasks }}/{{ runningJob.total_tasks }}
            <template v-if="runningJobEta">
              · {{ t('jobs.remainingTime', { time: runningJobEta }) }}</template
            >
          </span>
        </NSpace>
        <NSpace :size="8">
          <template v-if="!queueStatus.isPaused">
            <NButton size="small" @click="handlePause">{{ t('batch.actions.pause') }}</NButton>
          </template>
          <template v-else>
            <NButton size="small" type="primary" @click="handleResume">{{
              t('batch.actions.resume')
            }}</NButton>
          </template>
          <NButton size="small" type="error" quaternary @click="handleCancel">{{
            t('batch.actions.cancel')
          }}</NButton>
        </NSpace>
      </NSpace>
      <NProgress
        type="line"
        :percentage="getJobProgress(runningJob)"
        :show-indicator="false"
        style="margin-top: 8px"
        status="info"
      />
    </NCard>

    <!-- Job cards (draggable) -->
    <VueDraggable
      v-if="batchJobs.length > 0"
      v-model="batchJobs"
      :animation="200"
      handle=".job-drag-handle"
      style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px"
      @end="handleReorderJobs"
    >
      <NCard
        v-for="job in batchJobs"
        :key="job.id as string"
        size="small"
        :style="{
          borderRadius: '12px',
          borderLeft:
            job.status === 'running'
              ? '3px solid #f0a020'
              : job.status === 'completed'
                ? '3px solid #63e2b7'
                : job.status === 'failed'
                  ? '3px solid #e88080'
                  : undefined
        }"
      >
        <div style="display: flex; justify-content: space-between; align-items: flex-start">
          <div style="display: flex; align-items: flex-start">
            <span
              class="job-drag-handle"
              style="cursor: grab; padding: 2px 8px 0 0; opacity: 0.3; font-size: 14px"
              >⠿</span
            >
            <div>
              <div style="font-weight: 600">{{ job.name }}</div>
              <NSpace :size="6" style="margin-top: 4px">
                <NTag :type="statusColors[job.status as string] || 'default'" size="small" round>
                  {{ statusLabels[job.status as string] || job.status }}
                </NTag>
                <span style="font-size: 12px; opacity: 0.5">
                  {{
                    t('jobs.taskCount', {
                      completed: job.completed_tasks ?? 0,
                      total: job.total_tasks ?? 0
                    })
                  }}
                </span>
                <NTag v-if="(job.failed_tasks as number) > 0" type="error" size="small" round>
                  {{ t('jobs.failedCount', { count: job.failed_tasks }) }}
                </NTag>
              </NSpace>
            </div>
          </div>
        </div>

        <NProgress
          v-if="(job.total_tasks as number) > 0"
          type="line"
          :percentage="getJobProgress(job)"
          :show-indicator="false"
          style="margin-top: 8px"
          :status="
            job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'default'
          "
        />

        <NSpace size="small" style="margin-top: 10px">
          <NButton
            v-if="job.status === 'draft' || job.status === 'queued'"
            size="tiny"
            type="primary"
            :disabled="!connectionStore.isConnected || queueStatus.isProcessing"
            @click="handleStartJob(job.id as string)"
            >{{ t('batch.actions.start') }}</NButton
          >
          <NButton size="tiny" quaternary @click="handleEditJob(job)">{{
            t('batch.actions.edit')
          }}</NButton>
          <NButton
            v-if="
              job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
            "
            size="tiny"
            quaternary
            type="warning"
            :disabled="queueStatus.isProcessing"
            @click="handleRerunJob(job)"
            >{{ t('batch.actions.rerun') }}</NButton
          >
          <NButton size="tiny" quaternary type="info" @click="handleCloneJob(job)">{{
            t('batch.actions.clone')
          }}</NButton>
          <NButton size="tiny" quaternary type="error" @click="handleDeleteJob(job.id as string)">{{
            t('batch.actions.delete')
          }}</NButton>
        </NSpace>
      </NCard>
    </VueDraggable>
    <NCard v-else>
      <NEmpty :description="t('jobs.emptyHint')" />
    </NCard>

    <!-- ═══ Wizard Modal ═══ -->
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
        <!-- ═══ Step 1: Basic settings ═══ -->
        <div v-show="currentStep === 1">
          <NForm label-placement="top">
            <NGrid :cols="2" :x-gap="16">
              <NGridItem>
                <NFormItem :label="t('batch.wizard.jobNameLabel')" required>
                  <NInput
                    v-model:value="batchName"
                    :placeholder="t('batch.wizard.nameExamplePlaceholder')"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem :label="t('batch.wizard.workflowLabel')" required>
                  <NSelect
                    v-model:value="selectedWorkflowId"
                    :options="workflowOptions"
                    :placeholder="t('batch.wizard.workflowPlaceholder')"
                  />
                </NFormItem>
              </NGridItem>
            </NGrid>
            <NFormItem :label="t('batch.wizard.descriptionLabel')">
              <NInput
                v-model:value="batchDescription"
                :placeholder="t('batch.wizard.optionalPlaceholder')"
              />
            </NFormItem>
            <NGrid :cols="3" :x-gap="16">
              <NGridItem>
                <NFormItem :label="t('batch.wizard.countLabel')">
                  <NInputNumber
                    v-model:value="countPerCombination"
                    :min="1"
                    :max="10000"
                    style="width: 100%"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem :label="t('batch.wizard.seedModeLabel')">
                  <NSelect v-model:value="seedMode" :options="seedModeOptions" />
                </NFormItem>
              </NGridItem>
              <NGridItem v-if="seedMode !== 'random'">
                <NFormItem :label="t('batch.wizard.seedValueLabel')">
                  <NInputNumber
                    v-model:value="fixedSeed"
                    :min="0"
                    :max="2147483647"
                    style="width: 100%"
                  />
                </NFormItem>
              </NGridItem>
            </NGrid>
          </NForm>
        </div>

        <!-- ═══ Step 2: Modules & Prompts ═══ -->
        <div v-show="currentStep === 2">
          <NGrid :cols="2" :x-gap="16">
            <!-- Left: Module matrix -->
            <NGridItem>
              <div style="font-weight: 600; margin-bottom: 8px">
                {{ t('batch.wizard.moduleSection') }}
              </div>
              <NSelect
                v-model:value="moduleToAdd"
                :placeholder="t('batch.wizard.addModuleShortPlaceholder')"
                size="small"
                :options="
                  availableModules
                    .filter((m) => !moduleSelections.some((s) => s.moduleId === m.id))
                    .map((m) => ({
                      label: `${m.name} (${t('module.type.' + m.type)})`,
                      value: m.id
                    }))
                "
                style="margin-bottom: 10px"
                @update:value="addModuleToMatrix"
              />

              <div
                v-for="sel in moduleSelections"
                :key="sel.moduleId"
                style="
                  padding: 10px;
                  border-radius: 10px;
                  background: rgba(128, 128, 128, 0.06);
                  margin-bottom: 8px;
                "
              >
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 6px;
                  "
                >
                  <NSpace align="center" :size="6">
                    <NTag size="small" round>{{ t('module.type.' + sel.moduleType) }}</NTag>
                    <strong style="font-size: 13px">{{ sel.moduleName }}</strong>
                    <span style="font-size: 11px; opacity: 0.5"
                      >{{ sel.selectedItemIds.length }}/{{ sel.items.length }}</span
                    >
                  </NSpace>
                  <NSpace :size="2">
                    <NButton
                      size="tiny"
                      quaternary
                      @click="sel.selectedItemIds = sel.items.map((i) => i.id)"
                      >{{ t('batch.wizard.selectAllShort') }}</NButton
                    >
                    <NButton size="tiny" quaternary @click="sel.selectedItemIds = []">{{
                      t('batch.wizard.deselectAllShort')
                    }}</NButton>
                    <NButton
                      size="tiny"
                      quaternary
                      type="error"
                      @click="removeModuleFromMatrix(sel.moduleId)"
                      >✕</NButton
                    >
                  </NSpace>
                </div>
                <NCheckboxGroup v-model:value="sel.selectedItemIds">
                  <NSpace :size="4" :wrap="true">
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
                  style="margin-top: 6px; font-size: 12px"
                >
                  {{ t('batch.wizard.noItemsShort') }}
                </NAlert>
              </div>

              <NAlert v-if="moduleSelections.length === 0" type="info" style="font-size: 12px">
                {{ t('batch.wizard.addModulesHintShort') }}
              </NAlert>
            </NGridItem>

            <!-- Right: Slot mappings -->
            <NGridItem>
              <div style="font-weight: 600; margin-bottom: 8px">
                {{ t('batch.wizard.slotSectionShort') }}
              </div>

              <NAlert
                v-if="slotMappings.length === 0"
                type="info"
                style="font-size: 12px; margin-bottom: 8px"
              >
                {{ t('batch.wizard.noSlotsShort') }}
              </NAlert>

              <div
                v-for="slot in slotMappings"
                :key="slot.variableId"
                style="
                  padding: 10px;
                  border-radius: 10px;
                  background: rgba(128, 128, 128, 0.06);
                  margin-bottom: 8px;
                "
              >
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 6px;
                  "
                >
                  <NSpace align="center" :size="6">
                    <NTag
                      size="small"
                      :type="slot.role === 'prompt_positive' ? 'success' : 'error'"
                      round
                    >
                      {{
                        slot.role === 'prompt_positive'
                          ? t('batch.wizard.positive')
                          : t('batch.wizard.negative')
                      }}
                    </NTag>
                    <span style="font-size: 13px">{{ slot.displayName }}</span>
                  </NSpace>
                  <NSelect
                    v-model:value="slot.action"
                    :options="[
                      { label: t('batch.wizard.actionInjectShort'), value: 'inject' },
                      { label: t('batch.wizard.actionFixedShort'), value: 'fixed' }
                    ]"
                    size="small"
                    style="width: 120px"
                  />
                </div>

                <NInput
                  v-if="slot.action === 'fixed'"
                  v-model:value="slot.fixedValue"
                  type="textarea"
                  :rows="2"
                  size="small"
                  :placeholder="t('batch.wizard.fixedPlaceholder')"
                />

                <template v-if="slot.action === 'inject'">
                  <div style="margin-bottom: 6px">
                    <span style="font-size: 11px; opacity: 0.6">{{
                      t('batch.wizard.prefixModulesShort')
                    }}</span>
                    <NSelect
                      :value="null"
                      filterable
                      size="small"
                      :placeholder="t('batch.wizard.prefixModuleShortPlaceholder')"
                      :options="
                        availableModules
                          .filter((m) => !slot.prefixModuleIds.includes(m.id))
                          .map((m) => ({
                            label: `${m.name} (${t('module.type.' + m.type)})`,
                            value: m.id
                          }))
                      "
                      @update:value="(v: string) => addPrefixModule(slot, v)"
                    />
                    <VueDraggable
                      v-if="slot.prefixModuleIds.length > 0"
                      v-model="slot.prefixModuleIds"
                      :animation="200"
                      style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px"
                    >
                      <NTag
                        v-for="mid in slot.prefixModuleIds"
                        :key="mid"
                        size="small"
                        round
                        closable
                        style="cursor: grab"
                        @close="removePrefixModule(slot, mid)"
                      >
                        {{ getModuleName(mid) }}
                      </NTag>
                    </VueDraggable>
                  </div>
                  <NInput
                    v-model:value="slot.prefixText"
                    size="small"
                    :placeholder="t('batch.wizard.prefixTextPlaceholder')"
                    style="margin-bottom: 6px"
                  />
                  <div v-if="moduleSelections.length > 0" style="margin-bottom: 6px">
                    <span style="font-size: 11px; opacity: 0.6">{{
                      t('batch.wizard.matrixModulesShort')
                    }}</span>
                    <NCheckboxGroup v-model:value="slot.assignedModuleIds">
                      <NSpace :size="4" :wrap="true">
                        <NCheckbox
                          v-for="sel in moduleSelections"
                          :key="sel.moduleId"
                          :value="sel.moduleId"
                          :label="sel.moduleName"
                        />
                      </NSpace>
                    </NCheckboxGroup>
                  </div>
                  <NInput
                    v-model:value="slot.suffixText"
                    size="small"
                    :placeholder="t('batch.wizard.suffixShortPlaceholder')"
                  />
                  <NInput
                    v-model:value="slot.promptVariant"
                    size="small"
                    :placeholder="t('batch.slot.variantPlaceholder')"
                    style="margin-top: 6px"
                  />
                </template>
              </div>
            </NGridItem>
          </NGrid>
        </div>

        <!-- ═══ Step 3: Confirm & Create ═══ -->
        <div v-show="currentStep === 3">
          <!-- Preview stats -->
          <NGrid :cols="3" :x-gap="16" style="margin-bottom: 16px">
            <NGridItem>
              <NStatistic
                :label="t('batch.wizard.moduleDimensions')"
                :value="moduleSelections.filter((s) => s.selectedItemIds.length > 0).length"
              />
            </NGridItem>
            <NGridItem>
              <NStatistic
                :label="t('batch.wizard.totalCombinationsShort')"
                :value="taskPreview.totalCombinations"
              />
            </NGridItem>
            <NGridItem>
              <NStatistic :label="t('batch.wizard.totalImagesShort')">
                <span
                  :style="{
                    color: taskPreview.totalTasks > 10000 ? '#e88080' : undefined,
                    fontWeight: 'bold'
                  }"
                >
                  {{ taskPreview.totalTasks.toLocaleString() }}
                </span>
              </NStatistic>
            </NGridItem>
          </NGrid>

          <NAlert v-if="taskPreview.totalTasks > 10000" type="warning" style="margin-bottom: 12px">
            {{
              t('batch.wizard.tooManyWarningShort', {
                count: taskPreview.totalTasks.toLocaleString()
              })
            }}
          </NAlert>

          <!-- Variable overrides -->
          <div v-if="variableOverrides.length > 0" style="margin-bottom: 16px">
            <NSpace
              align="center"
              :size="6"
              style="margin-bottom: 8px; cursor: pointer; user-select: none"
              @click="showOverrides = !showOverrides"
            >
              <span
                style="font-size: 12px; opacity: 0.6; transition: transform 0.15s"
                :style="{
                  display: 'inline-block',
                  transform: showOverrides ? 'rotate(90deg)' : 'rotate(0)'
                }"
                >▶</span
              >
              <span style="font-weight: 600">{{ t('batch.wizard.overrideOptional') }}</span>
              <NTag
                v-if="variableOverrides.filter((v) => v.enabled).length > 0"
                size="tiny"
                type="info"
                round
              >
                {{
                  t('batch.wizard.overrideCount', {
                    count: variableOverrides.filter((v) => v.enabled).length
                  })
                }}
              </NTag>
            </NSpace>
            <div v-show="showOverrides">
              <div
                v-for="vo in variableOverrides"
                :key="vo.variableId"
                style="
                  padding: 8px 10px;
                  border-radius: 8px;
                  background: rgba(128, 128, 128, 0.06);
                  margin-bottom: 6px;
                "
              >
                <NSpace align="center" justify="space-between">
                  <NSpace align="center" :size="8">
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
                      round
                    >
                      {{ varTypeLabels[vo.varType] || vo.varType }}
                    </NTag>
                    <span :style="{ opacity: vo.enabled ? 1 : 0.5, fontSize: '13px' }">{{
                      vo.displayName
                    }}</span>
                  </NSpace>
                  <span v-if="!vo.enabled" style="font-size: 11px; opacity: 0.4">{{
                    vo.defaultValue || t('batch.wizard.defaultValueShort')
                  }}</span>
                </NSpace>
                <div v-if="vo.enabled" style="margin-top: 6px">
                  <NSelect
                    v-if="vo.varType === 'model'"
                    v-model:value="vo.value"
                    :options="
                      (batchResources?.checkpoints || []).map((c) => ({ label: c, value: c }))
                    "
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
                  <NSelect
                    v-else-if="vo.varType === 'lora'"
                    v-model:value="vo.value"
                    :options="(batchResources?.loras || []).map((l) => ({ label: l, value: l }))"
                    filterable
                    size="small"
                    :fallback-option="(v: string) => ({ label: v, value: v })"
                  />
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
                  <NInput
                    v-else
                    v-model:value="vo.value"
                    size="small"
                    :placeholder="t('batch.wizard.overrideValuePlaceholder')"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Output patterns -->
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ t('batch.wizard.outputSettings') }}
          </div>
          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('batch.wizard.folderPattern')" label-placement="top">
                <NInput
                  v-model:value="outputPattern"
                  size="small"
                  placeholder="{job}/{character}/{outfit}/{emotion}"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('batch.wizard.filePattern')" label-placement="top">
                <NInput
                  v-model:value="filePattern"
                  size="small"
                  placeholder="{character}_{outfit}_{emotion}_{index}"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>
          <div style="font-size: 11px; opacity: 0.5; margin-top: -8px">
            {{ t('batch.wizard.availableVars', { lbrace: '{', rbrace: '}' }) }}
          </div>
        </div>
      </NScrollbar>

      <!-- Footer with navigation -->
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
              {{
                t('batch.wizard.submitCount', { count: taskPreview.totalTasks.toLocaleString() })
              }}
            </NButton>
          </NSpace>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
