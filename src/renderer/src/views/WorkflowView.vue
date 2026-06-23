<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NButton,
  NEmpty,
  NSpace,
  NTag,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NCollapse,
  NCollapseItem,
  NInput,
  NSelect,
  NForm,
  NFormItem,
  useDialog,
  useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { TrashOutline } from '@vicons/ionicons5'
import { useWorkflowStore, type WorkflowItem } from '@renderer/stores/workflow.store'
import PageShell from '@renderer/components/common/PageShell.vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import ActionableEmptyState from '@renderer/components/common/ActionableEmptyState.vue'
import OverflowActionMenu, {
  type OverflowAction
} from '@renderer/components/common/OverflowActionMenu.vue'
import { safeJsonParse } from '@renderer/utils/safe-json'
import { groupWorkflowVariables } from '@renderer/utils/workflow-variable-groups'
import {
  buildWorkflowCategoryOptions,
  buildWorkflowRoleLabels,
  buildWorkflowRoleOptions,
  buildWorkflowVarTypeLabels
} from '@renderer/utils/view-labels'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()
const workflowStore = useWorkflowStore()

const showDetailDrawer = ref(false)
const detailWorkflow = ref<Record<string, unknown> | null>(null)
const detailVariables = ref<Record<string, unknown>[]>([])
const editName = ref('')
const editDescription = ref('')
const originalName = ref('')
const originalDescription = ref('')

const hasMetadataChanges = computed(
  () => editName.value !== originalName.value || editDescription.value !== originalDescription.value
)

const variableGroups = computed(() => groupWorkflowVariables(detailVariables.value))

function getWorkflowActions(): OverflowAction[] {
  return [
    {
      key: 'delete',
      label: t('common.delete'),
      icon: TrashOutline,
      danger: true,
      confirmText: t('workflow.confirmDelete')
    }
  ]
}

const columns = computed<DataTableColumns<WorkflowItem>>(() => [
  { title: t('common.name'), key: 'name', width: 420, ellipsis: { tooltip: true } },
  {
    title: t('common.type'),
    key: 'category',
    width: 140,
    render(row) {
      return h(
        NTag,
        { size: 'small', round: true },
        { default: () => t(`workflow.category.${row.category}`) }
      )
    }
  },
  {
    title: t('workflow.variables'),
    key: 'variables',
    width: 100,
    render(row) {
      const vars = safeJsonParse<unknown[]>(row.variables || '[]', {
        context: 'Workflow variables',
        validate: Array.isArray,
        invalidShapeMessage: 'Workflow variables must be an array'
      })
      const count = vars.ok ? vars.value.length : 0
      return h(NTag, { size: 'small', round: true }, { default: () => `${count}` })
    }
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 180,
    render(row) {
      return h(
        NSpace,
        { size: 'small', align: 'center' },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                type: 'info',
                onClick: () => handleViewDetail(row.id)
              },
              { default: () => t('common.detail') }
            ),
            h(OverflowActionMenu, {
              actions: getWorkflowActions(),
              menuLabel: t('common.moreActions'),
              confirmPositiveText: t('common.delete'),
              confirmNegativeText: t('common.cancel'),
              onSelect: (action: string) => {
                if (action === 'delete') void handleDelete(row.id)
              }
            })
          ]
        }
      )
    }
  }
])

async function handleImport(): Promise<void> {
  const filePath = await window.electron.ipcRenderer.invoke('dialog:open-file', {
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (filePath) {
    const result = await window.electron.ipcRenderer.invoke('workflow:import', { filePath })
    if (result.error) {
      message.error(result.error)
    } else {
      message.success(
        t('workflow.msg.importSuccess', { name: result.name, count: result.variableCount })
      )
      await workflowStore.loadWorkflows()
    }
  }
}

async function handleViewDetail(id: string): Promise<void> {
  detailWorkflow.value = await workflowStore.getWorkflow(id)
  if (detailWorkflow.value) {
    editName.value = (detailWorkflow.value.name as string) || ''
    editDescription.value = (detailWorkflow.value.description as string) || ''
    originalName.value = editName.value
    originalDescription.value = editDescription.value
    detailVariables.value = await window.electron.ipcRenderer.invoke('workflow:variables', {
      workflowId: id
    })
    showDetailDrawer.value = true
  }
}

async function handleDelete(id: string): Promise<void> {
  await workflowStore.deleteWorkflow(id)
  message.success(t('workflow.msg.deleted'))
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
    originalName.value = editName.value
    originalDescription.value = editDescription.value
    message.success(t('workflow.msg.updated'))
    showDetailDrawer.value = false
  } catch (e) {
    message.error(
      t('workflow.msg.updateFailed', { error: e instanceof Error ? e.message : String(e) })
    )
  }
}

function requestCloseDetail(): void {
  if (!hasMetadataChanges.value) {
    showDetailDrawer.value = false
    return
  }

  dialog.warning({
    title: t('workflow.discardChangesTitle'),
    content: t('workflow.discardChangesDescription'),
    positiveText: t('common.discard'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      editName.value = originalName.value
      editDescription.value = originalDescription.value
      showDetailDrawer.value = false
    }
  })
}

function handleDrawerShowUpdate(show: boolean): void {
  if (!show) requestCloseDetail()
}

const categoryOptions = computed(() => buildWorkflowCategoryOptions(t))
const roleOptions = computed(() => buildWorkflowRoleOptions(t))

const roleColors: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  prompt_positive: 'success',
  prompt_negative: 'error',
  seed: 'warning',
  fixed: 'info',
  custom: 'default'
}

const roleLabels = computed(() => buildWorkflowRoleLabels(t))
const varTypeLabels = computed(() => buildWorkflowVarTypeLabels(t))

type TagType = 'info' | 'warning' | 'success' | 'default'
const varTypeTagColors: Record<string, TagType> = {
  text: 'info',
  seed: 'warning',
  model: 'success'
}

function getVarTypeTagType(varType: string): TagType {
  return varTypeTagColors[varType] || 'default'
}

async function handleRoleChange(variableId: string, role: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('workflow:update-variable-role', { variableId, role })
  const variable = detailVariables.value.find((item) => item.id === variableId)
  if (variable) variable.role = role
}

onMounted(() => {
  workflowStore.loadWorkflows()
})
</script>

<template>
  <PageShell>
    <PageHeader :title="t('workflow.title')" :description="t('workflow.pageDescription')">
      <template #actions>
        <NButton type="primary" @click="handleImport">
          {{ t('workflow.import') }}
        </NButton>
      </template>
    </PageHeader>

    <NCard class="workflow-table-card">
      <NDataTable
        v-if="workflowStore.workflows.length > 0"
        :columns="columns"
        :data="workflowStore.workflows"
        :loading="workflowStore.loading"
        :row-key="(row: WorkflowItem) => row.id"
      />
      <ActionableEmptyState
        v-else
        :title="t('workflow.empty')"
        :description="t('workflow.emptyDescription')"
        :action-label="t('workflow.import')"
        @action="handleImport"
      />
    </NCard>

    <NDrawer
      :show="showDetailDrawer"
      width="min(880px, 100vw)"
      :block-scroll="true"
      :trap-focus="true"
      @update:show="handleDrawerShowUpdate"
    >
      <NDrawerContent
        v-if="detailWorkflow"
        :title="(detailWorkflow.name as string) || ''"
        closable
        native-scrollbar
        @close="requestCloseDetail"
      >
        <NForm label-placement="left" label-width="100" class="workflow-metadata-form">
          <NFormItem :label="t('common.name')">
            <NInput v-model:value="editName" />
          </NFormItem>
          <NFormItem :label="t('common.description')">
            <NInput v-model:value="editDescription" type="textarea" :rows="2" />
          </NFormItem>
          <NFormItem :label="t('common.type')">
            <NSelect
              :value="detailWorkflow.category as string"
              :options="categoryOptions"
              @update:value="
                (value: string) => handleCategoryChange(detailWorkflow!.id as string, value)
              "
            />
          </NFormItem>
        </NForm>

        <p class="workflow-autosave-hint">{{ t('workflow.autoSaveHint') }}</p>

        <section class="workflow-variables">
          <div class="workflow-variables__header">
            <strong>{{ t('workflow.variableList', { count: detailVariables.length }) }}</strong>
          </div>

          <NCollapse
            v-if="variableGroups.length > 0"
            :default-expanded-names="['prompt_positive', 'prompt_negative', 'seed']"
          >
            <NCollapseItem v-for="group in variableGroups" :key="group.role" :name="group.role">
              <template #header>
                <div class="workflow-group__header">
                  <NTag :type="roleColors[group.role]" size="small" round>
                    {{ roleLabels[group.role] }}
                  </NTag>
                  <span>{{ t('workflow.groupCount', { count: group.variables.length }) }}</span>
                </div>
              </template>

              <article
                v-for="variable in group.variables"
                :key="variable.id as string"
                class="workflow-variable"
              >
                <div class="workflow-variable__header">
                  <div class="workflow-variable__identity">
                    <NTag size="small" round :type="getVarTypeTagType(variable.var_type as string)">
                      {{ varTypeLabels[variable.var_type as string] || variable.var_type }}
                    </NTag>
                    <strong>{{ variable.display_name }}</strong>
                  </div>
                  <span class="workflow-variable__node">
                    {{ variable.node_id }}:{{ variable.field_name }}
                  </span>
                </div>

                <div class="workflow-variable__controls">
                  <span>{{ t('workflow.roleLabel') }}</span>
                  <NSelect
                    :value="(variable.role as string) || 'custom'"
                    :options="roleOptions"
                    size="small"
                    @update:value="
                      (value: string) => handleRoleChange(variable.id as string, value)
                    "
                  />
                </div>

                <div v-if="variable.default_val" class="workflow-variable__default">
                  {{ t('workflow.defaultValue', { value: variable.default_val }) }}
                </div>
              </article>
            </NCollapseItem>
          </NCollapse>
          <NEmpty v-else :description="t('workflow.noVariables')" />
        </section>

        <template #footer>
          <NSpace justify="end">
            <NButton @click="requestCloseDetail">{{ t('common.close') }}</NButton>
            <NButton type="primary" :disabled="!hasMetadataChanges" @click="handleSaveWorkflow">
              {{ t('common.save') }}
            </NButton>
          </NSpace>
        </template>
      </NDrawerContent>
    </NDrawer>
  </PageShell>
</template>

<style scoped>
.workflow-table-card {
  max-width: 1040px;
}

.workflow-metadata-form {
  max-width: 760px;
}

.workflow-autosave-hint {
  margin: 2px 0 20px 100px;
  color: var(--app-text-muted);
  font-size: 12px;
}

.workflow-variables {
  margin-top: 8px;
}

.workflow-variables__header {
  margin-bottom: 10px;
}

.workflow-group__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workflow-group__header span:last-child {
  color: var(--app-text-muted);
  font-size: 12px;
}

.workflow-variable {
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--app-surface-muted);
  margin-bottom: 8px;
}

.workflow-variable__header,
.workflow-variable__identity,
.workflow-variable__controls {
  display: flex;
  align-items: center;
}

.workflow-variable__header {
  justify-content: space-between;
  gap: 12px;
}

.workflow-variable__identity {
  min-width: 0;
  gap: 8px;
}

.workflow-variable__identity strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-variable__node,
.workflow-variable__default {
  color: var(--app-text-subtle);
  font-size: 11px;
}

.workflow-variable__node {
  flex-shrink: 0;
}

.workflow-variable__controls {
  gap: 8px;
  margin-top: 8px;
  color: var(--app-text-muted);
  font-size: 12px;
}

.workflow-variable__controls .n-select {
  width: 180px;
}

.workflow-variable__default {
  overflow: hidden;
  margin-top: 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .workflow-autosave-hint {
    margin-left: 0;
  }

  .workflow-variable__header {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
}
</style>
