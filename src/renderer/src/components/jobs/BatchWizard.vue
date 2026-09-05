<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NModal,
  NScrollbar,
  NSelect,
  NSpace,
  useMessage
} from 'naive-ui'
import { useModuleStore, type ModuleItem, type PromptModule } from '@renderer/stores/module.store'
import { useSettingsStore } from '@renderer/stores/settings.store'
import { useWorkflowStore } from '@renderer/stores/workflow.store'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { WorkflowVariableRecord } from '@shared/ipc-contract'
import { isJsonObject, safeJsonParse } from '@shared/safe-json'
import {
  buildBatchSeedModeOptions,
  buildWorkflowRoleOptions,
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
const settingsStore = useSettingsStore()
const workflowStore = useWorkflowStore()
const saving = ref(false)
const variablesLoading = ref(false)
const variablesError = ref(false)
const workflowVariables = ref<WorkflowVariableRecord[]>([])
const roleSaving = ref(false)
const roleOptions = computed(() => buildWorkflowRoleOptions(t))
const initializing = ref(false)
let wizardGeneration = 0
let workflowRequest = 0
let loadedWorkflowId: string | null = null
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
const canSave = computed(
  () =>
    !initializing.value &&
    !saving.value &&
    !variablesLoading.value &&
    !variablesError.value &&
    !roleSaving.value &&
    Boolean(batchName.value.trim() && selectedWorkflowId.value) &&
    taskPreview.value.totalTasks > 0
)
const selectedModules = computed(() =>
  moduleSelections.value.filter((selection) => selection.selectedItemIds.length > 0)
)

async function updateVariableRole(variableId: string, role: string): Promise<void> {
  if (roleSaving.value) return
  roleSaving.value = true
  const generation = wizardGeneration
  const workflowId = selectedWorkflowId.value
  try {
    const updated = await invokeIpc(IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_ROLE, {
      variableId,
      role
    })
    if (!updated) throw new Error(t('batch.editor.roleSaveFailed'))
    if (!isCurrentWizard(generation) || workflowId !== selectedWorkflowId.value) return
    await loadWorkflowVariables(workflowId, generation)
    if (!isCurrentWizard(generation) || workflowId !== selectedWorkflowId.value) return
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    roleSaving.value = false
  }
}

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

function isCurrentWizard(generation: number): boolean {
  return props.show && generation === wizardGeneration
}

async function loadWorkflowVariables(
  workflowId: string | null,
  generation = wizardGeneration
): Promise<void> {
  const request = ++workflowRequest
  const isCurrent = (): boolean => isCurrentWizard(generation) && request === workflowRequest
  variablesError.value = false
  variablesLoading.value = false
  if (workflowId !== loadedWorkflowId) {
    workflowVariables.value = []
    slotMappings.value = []
    variableOverrides.value = []
    batchResources.value = null
  }
  if (!workflowId) return
  variablesLoading.value = true
  let variables: WorkflowVariableRecord[]
  try {
    variables = await invokeIpc(IPC_CHANNELS.WORKFLOW_VARIABLES, { workflowId })
  } catch (error) {
    if (isCurrent()) {
      variablesError.value = true
      message.error(error instanceof Error ? error.message : String(error))
    }
    throw error
  } finally {
    if (isCurrent()) variablesLoading.value = false
  }
  if (!isCurrent()) return
  const previousSlots = loadedWorkflowId === workflowId ? slotMappings.value : []
  const previousOverrides = loadedWorkflowId === workflowId ? variableOverrides.value : []
  workflowVariables.value = variables
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
  for (const slot of slotMappings.value) {
    const previous = previousSlots.find(
      (entry) => entry.variableId === slot.variableId && entry.role === slot.role
    )
    if (previous) Object.assign(slot, previous)
  }
  for (const variable of variableOverrides.value) {
    const previous = previousOverrides.find(
      (entry) => entry.variableId === variable.variableId && entry.role === variable.role
    )
    if (previous) Object.assign(variable, previous)
  }
  loadedWorkflowId = workflowId
  try {
    const resources = await invokeIpc(IPC_CHANNELS.COMFYUI_MODELS)
    if (isCurrent()) batchResources.value = resources
  } catch {
    // Model suggestions are optional; manual overrides remain available offline.
  }
}

async function changeWorkflow(workflowId: string | null): Promise<void> {
  try {
    await loadWorkflowVariables(workflowId)
  } catch {
    // The loader exposes a retryable error and blocks saving until reconciliation succeeds.
  }
}

async function loadWizardSources(generation: number): Promise<void> {
  await Promise.all([
    moduleStore.loadModules(),
    workflowStore.loadWorkflows(),
    settingsStore.loaded ? Promise.resolve() : settingsStore.loadSettings()
  ])
  if (isCurrentWizard(generation)) availableModules.value = moduleStore.modules
}

async function initializeCreate(generation: number): Promise<void> {
  editingJobId.value = null
  await loadWizardSources(generation)
  if (!isCurrentWizard(generation)) return
  moduleSelections.value = []
  variableOverrides.value = []
  batchResources.value = null
  batchName.value = ''
  batchDescription.value = ''
  countPerCombination.value = 1
  seedMode.value = 'random'
  fixedSeed.value = 42
  outputPattern.value = settingsStore.settings.output_pattern
  filePattern.value = settingsStore.settings.filename_pattern
  showOverrides.value = false
  selectedWorkflowId.value = workflowOptions.value[0]?.value ?? null
  await loadWorkflowVariables(selectedWorkflowId.value, generation)
}

async function initializeFromJob(
  job: Record<string, unknown>,
  clone: boolean,
  generation: number
): Promise<void> {
  const parsedConfig = safeJsonParse<RestorableJobConfig>(job.config as string, {
    context: 'Batch job config',
    validate: isRestorableJobConfig,
    invalidShapeMessage: 'Batch job config has an invalid shape'
  })
  if (!parsedConfig.ok) throw new Error(parsedConfig.error)

  const config = parsedConfig.value
  await loadWizardSources(generation)
  if (!isCurrentWizard(generation)) return
  editingJobId.value = clone ? null : (job.id as string)
  batchName.value = clone ? `${job.name as string} ${t('batch.copySuffix')}` : (job.name as string)
  batchDescription.value = config.description || ''
  selectedWorkflowId.value = config.workflowId || null
  countPerCombination.value = config.countPerCombination || 1
  seedMode.value = config.seedMode || 'random'
  fixedSeed.value = config.fixedSeed ?? 42
  outputPattern.value = config.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
  filePattern.value = config.fileNamePattern || '{character}_{outfit}_{emotion}_{index}'

  await loadWorkflowVariables(selectedWorkflowId.value, generation)
  if (!isCurrentWizard(generation)) return
  moduleSelections.value = []
  for (const selection of config.moduleSelections ?? []) {
    const module = availableModules.value.find((entry) => entry.id === selection.moduleId)
    if (!module) continue
    const items = (await invokeIpc(IPC_CHANNELS.MODULE_ITEM_LIST, {
      moduleId: module.id
    })) as ModuleItem[]
    if (!isCurrentWizard(generation)) return
    moduleSelections.value.push({
      moduleId: module.id,
      moduleName: module.name,
      moduleType: selection.moduleType || module.type,
      items,
      selectedItemIds: selection.selectedItemIds ?? items.map((item) => item.id)
    })
  }
  for (const saved of config.slotMappings ?? []) {
    const slot = slotMappings.value.find(
      (entry) => entry.nodeId === saved.nodeId && entry.fieldName === saved.fieldName
    )
    if (!slot) continue
    slot.action = saved.action === 'fixed' ? 'fixed' : 'inject'
    slot.fixedValue = (saved.fixedValue as string) || ''
    slot.assignedModuleIds = (saved.assignedModuleIds as string[]) || []
    slot.prefixModuleIds = (saved.prefixModuleIds as string[]) || []
    slot.prefixText = (saved.userPrefixText as string) ?? (saved.prefixText as string) ?? ''
    slot.suffixText = (saved.suffixText as string) || ''
    slot.promptVariant = (saved.promptVariant as string) || ''
  }
  showOverrides.value = Boolean(config.variableOverrides?.length)
  for (const saved of config.variableOverrides ?? []) {
    const variable = variableOverrides.value.find(
      (entry) => entry.nodeId === saved.nodeId && entry.fieldName === saved.fieldName
    )
    if (!variable) continue
    variable.enabled = true
    variable.value = (saved.value as string) || ''
  }
}

async function initializeWizard(generation: number): Promise<void> {
  initializing.value = true
  loadedWorkflowId = null
  try {
    if (props.mode === 'create') {
      await initializeCreate(generation)
    } else if (props.sourceJob) {
      await initializeFromJob(props.sourceJob, props.mode === 'clone', generation)
    }
  } catch (error) {
    if (!isCurrentWizard(generation)) return
    message.error(
      t('batch.msg.restoreFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
    showWizard.value = false
  } finally {
    if (isCurrentWizard(generation)) initializing.value = false
  }
}

watch(
  () => [props.show, props.mode, props.sourceJob] as const,
  ([show]) => {
    const generation = ++wizardGeneration
    if (show) void initializeWizard(generation)
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  wizardGeneration++
})

async function handleCreateBatch(): Promise<void> {
  if (!canSave.value || !selectedWorkflowId.value) return

  saving.value = true
  try {
    const config = {
      name: batchName.value.trim(),
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
    }

    const result = editingJobId.value
      ? await invokeIpc(IPC_CHANNELS.BATCH_UPDATE_DRAFT, {
          id: editingJobId.value,
          config
        })
      : await invokeIpc(IPC_CHANNELS.BATCH_CREATE, config)

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
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal
    v-model:show="showWizard"
    preset="card"
    class="batch-editor"
    :class="{ 'app-theme-light': settingsStore.settings.theme === 'light' }"
    style="width: min(1440px, calc(100vw - 32px)); max-height: calc(100vh - 32px)"
    :title="editingJobId ? t('batch.wizard.editTitle') : t('batch.wizard.createTitle')"
    :mask-closable="false"
    :close-on-esc="!saving && !roleSaving"
    :closable="!saving && !roleSaving"
    :bordered="false"
  >
    <p class="batch-editor__intro">{{ t('batch.editor.hint') }}</p>
    <div class="batch-editor__workspace">
      <NScrollbar class="batch-editor__scroll">
        <div class="batch-editor__main" :inert="initializing || saving || roleSaving">
          <section class="batch-editor__section">
            <h2>{{ t('batch.wizard.stepBasic') }}</h2>
            <WizardStepWorkflow
              v-model:batch-name="batchName"
              v-model:selected-workflow-id="selectedWorkflowId"
              v-model:batch-description="batchDescription"
              v-model:count-per-combination="countPerCombination"
              v-model:seed-mode="seedMode"
              v-model:fixed-seed="fixedSeed"
              :workflow-options="workflowOptions"
              :generation-workflow-hint="generationWorkflowHint"
              :seed-mode-options="seedModeOptions"
              :disabled="initializing || saving || roleSaving"
              @update:selected-workflow-id="changeWorkflow"
            />
          </section>
          <section class="batch-editor__section">
            <h2>{{ t('batch.wizard.stepModules') }}</h2>
            <NAlert v-if="variablesError" type="error" class="batch-editor__notice">
              {{ t('batch.editor.variablesFailed') }}
              <NButton size="small" @click="changeWorkflow(selectedWorkflowId)">{{
                t('common.retry')
              }}</NButton>
            </NAlert>
            <div :inert="variablesLoading || variablesError">
              <WizardStepModules
                v-model:module-selections="moduleSelections"
                v-model:module-to-add="moduleToAdd"
                v-model:slot-mappings="slotMappings"
                :available-modules="availableModules"
              />
            </div>
            <NCollapse v-if="workflowVariables.length" class="batch-editor__roles">
              <NCollapseItem :title="t('batch.editor.editRoles')" name="roles">
                <p class="batch-editor__intro">{{ t('batch.editor.rolesHint') }}</p>
                <div
                  v-for="variable in workflowVariables"
                  :key="variable.id"
                  class="batch-editor__role"
                >
                  <span
                    >{{ variable.display_name }}
                    <small>{{ variable.node_id }} · {{ variable.field_name }}</small></span
                  >
                  <NSelect
                    :value="variable.role"
                    :options="roleOptions"
                    :aria-label="t('batch.editor.roleLabel', { name: variable.display_name })"
                    :disabled="roleSaving || variablesLoading"
                    @update:value="(role) => updateVariableRole(variable.id, role)"
                  />
                </div>
              </NCollapseItem>
            </NCollapse>
          </section>
          <section class="batch-editor__section">
            <h2>{{ t('batch.editor.outputSettings') }}</h2>
            <WizardStepConfirm
              v-model:variable-overrides="variableOverrides"
              v-model:show-overrides="showOverrides"
              v-model:output-pattern="outputPattern"
              v-model:file-pattern="filePattern"
              :module-selections="moduleSelections"
              :task-preview="taskPreview"
              :batch-resources="batchResources"
              :var-type-labels="varTypeLabels"
              :show-summary="false"
            />
          </section>
        </div>
      </NScrollbar>
      <aside class="batch-editor__summary" aria-live="polite" aria-atomic="true">
        <span class="section-eyebrow">{{ t('batch.editor.summary') }}</span>
        <div class="batch-editor__total">
          {{ taskPreview.totalTasks.toLocaleString()
          }}<span>{{ t('jobs.production.imagesUnit') }}</span>
        </div>
        <p>
          {{
            t('batch.editor.formula', {
              combinations: taskPreview.totalCombinations.toLocaleString(),
              count: countPerCombination
            })
          }}
        </p>
        <ul v-if="selectedModules.length">
          <li v-for="selection in selectedModules" :key="selection.moduleId">
            <span>{{ selection.moduleName }}</span
            ><strong>{{ selection.selectedItemIds.length }}</strong>
          </li>
        </ul>
        <p v-else class="batch-editor__notice">{{ t('batch.editor.selectItemsHint') }}</p>
        <NAlert v-if="taskPreview.totalTasks > 10000" type="warning" :show-icon="false">
          {{
            t('batch.wizard.tooManyWarningShort', {
              count: taskPreview.totalTasks.toLocaleString()
            })
          }}
        </NAlert>
        <p class="batch-editor__notice">{{ t('batch.editor.saveHint') }}</p>
      </aside>
    </div>
    <template #footer>
      <NSpace justify="space-between" align="center">
        <span class="batch-editor__footer-hint">{{ t('batch.editor.requiredHint') }}</span>
        <NSpace>
          <NButton :disabled="saving || roleSaving" @click="showWizard = false">{{
            t('common.cancel')
          }}</NButton>
          <NButton type="primary" :disabled="!canSave" :loading="saving" @click="handleCreateBatch">
            {{ editingJobId ? t('batch.wizard.submitEdit') : t('batch.wizard.submitCreate') }}
            {{ t('batch.wizard.submitCount', { count: taskPreview.totalTasks.toLocaleString() }) }}
          </NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.batch-editor__intro,
.batch-editor__footer-hint {
  color: var(--app-text-muted);
  font-size: 13px;
}
.batch-editor__intro {
  margin: 0 0 18px;
}
.batch-editor__workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 24px;
  align-items: start;
  height: calc(100vh - 220px);
  grid-template-rows: minmax(0, 1fr);
}
.batch-editor__scroll {
  height: 100%;
}
.batch-editor__main {
  padding-right: 10px;
  min-width: 0;
}
.batch-editor__section {
  padding: 0 0 20px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--app-border);
}
.batch-editor__section h2 {
  font-size: 17px;
  margin-bottom: 18px;
}
.batch-editor__summary {
  max-height: 100%;
  overflow-y: auto;
  padding: 22px;
  background: var(--app-surface-raised);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
}
.batch-editor__total {
  margin: 12px 0 6px;
  font-size: 38px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.batch-editor__total span {
  margin-left: 8px;
  font-size: 15px;
  font-weight: 400;
}
.batch-editor__summary p {
  color: var(--app-text-muted);
  font-size: 13px;
}
.batch-editor__summary ul {
  list-style: none;
  margin: 20px 0;
}
.batch-editor__summary li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--app-border-subtle);
}
.batch-editor__notice {
  margin: 14px 0;
}
.batch-editor__roles {
  margin-top: 20px;
}
.batch-editor__role {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}
.batch-editor__role small {
  display: block;
  color: var(--app-text-muted);
}
@media (max-width: 1000px) {
  .batch-editor__workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
  }
  .batch-editor__scroll {
    grid-row: 2;
  }
  .batch-editor__summary {
    grid-row: 1;
    width: 100%;
    padding: 10px 16px;
  }
  .batch-editor__summary ul {
    display: none;
  }
  .batch-editor__summary .batch-editor__notice {
    display: none;
  }
  .batch-editor__total {
    margin: 0;
    font-size: 28px;
  }
}
@media (max-width: 640px) {
  .batch-editor__role {
    grid-template-columns: 1fr;
  }
  .batch-editor__footer-hint {
    display: none;
  }
}
</style>
