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
  NSwitch,
  NGrid,
  NGridItem,
  NDivider,
  NIcon,
  NTooltip,
  useMessage
} from 'naive-ui'
import { ArrowBackOutline, CreateOutline, PencilOutline, TrashOutline } from '@vicons/ionicons5'
import { VueDraggable } from 'vue-draggable-plus'
import { useModuleStore, type PromptModule, type ModuleItem } from '@renderer/stores/module.store'
import { buildModulePromptPreviewLabels } from '@renderer/utils/view-labels'
import PageShell from '@renderer/components/common/PageShell.vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import ActionableEmptyState from '@renderer/components/common/ActionableEmptyState.vue'
import OverflowActionMenu, {
  type OverflowAction
} from '@renderer/components/common/OverflowActionMenu.vue'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const { t } = useI18n()
const message = useMessage()
const moduleStore = useModuleStore()

// Create module modal
const showCreateModal = ref(false)
const newModule = ref({ name: '', type: 'custom' as string, description: '' })

// Module detail panel
const selectedModuleId = ref<string | null>(null)
const selectedModule = ref<PromptModule | null>(null)

// Item editor modal
const showItemModal = ref(false)
const editingItem = ref<Partial<ModuleItem> & { isNew?: boolean }>({})

// Prompt variants for current editing item
const editingVariants = ref<Array<{ name: string; prompt: string; negative: string }>>([])

// Prompt preview
const promptPreview = ref<{ positive: string; negative: string } | null>(null)

const moduleTypeOptions = computed(() => [
  { label: t('module.type.character'), value: 'character' },
  { label: t('module.type.outfit'), value: 'outfit' },
  { label: t('module.type.emotion'), value: 'emotion' },
  { label: t('module.type.style'), value: 'style' },
  { label: t('module.type.artist'), value: 'artist' },
  { label: t('module.type.quality'), value: 'quality' },
  { label: t('module.type.negative'), value: 'negative' },
  { label: t('module.type.lora'), value: 'lora' },
  { label: t('module.type.custom'), value: 'custom' }
])

const promptPreviewLabels = computed(() => buildModulePromptPreviewLabels(t))

const filterType = ref<string | null>(null)
const filteredModules = computed(() => {
  if (!filterType.value) return moduleStore.modules
  return moduleStore.modules.filter((m) => m.type === filterType.value)
})

// Watch selected module to load items
watch(selectedModuleId, async (id) => {
  if (id) {
    const mod = await moduleStore.getModule(id)
    selectedModule.value = mod
    await moduleStore.loadItems(id)
    await updatePreview()
  } else {
    selectedModule.value = null
    moduleStore.currentItems = []
    promptPreview.value = null
  }
})

async function updatePreview(): Promise<void> {
  if (!selectedModuleId.value) {
    promptPreview.value = null
    return
  }
  try {
    promptPreview.value = await invokeIpc(IPC_CHANNELS.PROMPT_PREVIEW, {
      moduleIds: [selectedModuleId.value]
    })
  } catch (error) {
    void error
    promptPreview.value = null
  }
}

async function handleCreate(): Promise<void> {
  if (!newModule.value.name) return
  try {
    await moduleStore.createModule(newModule.value)
    showCreateModal.value = false
    newModule.value = { name: '', type: 'custom', description: '' }
    message.success(t('module.msg.created'))
  } catch (e) {
    message.error(
      t('module.msg.createFailed', { error: e instanceof Error ? e.message : String(e) })
    )
  }
}

// Edit module modal
const showEditModuleModal = ref(false)
const editModule = ref({ id: '', name: '', type: 'custom' as string, description: '' })

function openEditModule(mod: PromptModule): void {
  editModule.value = {
    id: mod.id,
    name: mod.name,
    type: mod.type,
    description: mod.description || ''
  }
  showEditModuleModal.value = true
}

async function handleEditModule(): Promise<void> {
  if (!editModule.value.name) return
  try {
    await moduleStore.updateModule(editModule.value.id, {
      name: editModule.value.name,
      type: editModule.value.type,
      description: editModule.value.description
    })
    showEditModuleModal.value = false
    if (selectedModuleId.value === editModule.value.id) {
      selectedModule.value = await moduleStore.getModule(editModule.value.id)
    }
    message.success(t('module.msg.updated'))
  } catch (e) {
    message.error(
      t('module.msg.updateFailed', { error: e instanceof Error ? e.message : String(e) })
    )
  }
}

async function handleDeleteModule(id: string): Promise<void> {
  if (selectedModuleId.value === id) selectedModuleId.value = null
  await moduleStore.deleteModule(id)
  message.success(t('module.msg.deleted'))
}

function selectModule(id: string): void {
  selectedModuleId.value = selectedModuleId.value === id ? null : id
}

function getModuleActions(): OverflowAction[] {
  return [
    { key: 'edit', label: t('common.edit'), icon: CreateOutline },
    {
      key: 'delete',
      label: t('common.delete'),
      icon: TrashOutline,
      danger: true,
      confirmText: t('module.confirmDelete')
    }
  ]
}

function handleModuleAction(action: string, mod: PromptModule): void {
  if (action === 'edit') openEditModule(mod)
  if (action === 'delete') void handleDeleteModule(mod.id)
}

function getItemActions(): OverflowAction[] {
  return [
    {
      key: 'delete',
      label: t('common.delete'),
      icon: TrashOutline,
      danger: true,
      confirmText: t('module.confirmDelete')
    }
  ]
}

function handleItemAction(action: string, item: ModuleItem): void {
  if (action === 'delete') void handleDeleteItem(item)
}

// Item CRUD
function openAddItem(): void {
  if (!selectedModuleId.value) return
  editingItem.value = {
    isNew: true,
    module_id: selectedModuleId.value,
    name: '',
    prompt: '',
    negative: '',
    weight: 1.0,
    sort_order: moduleStore.currentItems.length,
    enabled: 1,
    prompt_variants: {}
  }
  editingVariants.value = []
  showItemModal.value = true
}

function openEditItem(item: ModuleItem): void {
  editingItem.value = { ...item, isNew: false }
  const pv = item.prompt_variants || {}
  editingVariants.value = Object.entries(pv).map(([name, v]) => ({
    name,
    prompt: v.prompt || '',
    negative: v.negative || ''
  }))
  showItemModal.value = true
}

function addVariant(): void {
  editingVariants.value.push({ name: '', prompt: '', negative: '' })
}

function removeVariant(idx: number): void {
  editingVariants.value.splice(idx, 1)
}

function variantsToRecord(): Record<string, { prompt: string; negative: string }> {
  const record: Record<string, { prompt: string; negative: string }> = {}
  for (const v of editingVariants.value) {
    if (v.name.trim()) {
      record[v.name.trim()] = { prompt: v.prompt, negative: v.negative }
    }
  }
  return record
}

async function handleSaveItem(): Promise<void> {
  const item = editingItem.value
  if (!item.name || !item.prompt) {
    message.warning(t('module.msg.nameAndPromptRequired'))
    return
  }

  const promptVariants = variantsToRecord()

  if (item.isNew && selectedModuleId.value) {
    await moduleStore.createItem({
      module_id: selectedModuleId.value,
      name: item.name!,
      prompt: item.prompt!,
      negative: item.negative,
      weight: item.weight,
      sort_order: item.sort_order,
      prompt_variants: promptVariants
    })
    message.success(t('module.msg.itemAdded'))
  } else if (item.id && selectedModuleId.value) {
    await moduleStore.updateItem(item.id, selectedModuleId.value, {
      name: item.name,
      prompt: item.prompt,
      negative: item.negative,
      weight: item.weight,
      sort_order: item.sort_order,
      enabled: item.enabled,
      prompt_variants: JSON.stringify(promptVariants)
    })
    message.success(t('module.msg.itemUpdated'))
  }

  showItemModal.value = false
  await updatePreview()
}

async function handleDeleteItem(item: ModuleItem): Promise<void> {
  if (!selectedModuleId.value) return
  await moduleStore.deleteItem(item.id, selectedModuleId.value)
  message.success(t('module.msg.itemDeleted'))
  await updatePreview()
}

async function handleToggleItem(item: ModuleItem): Promise<void> {
  if (!selectedModuleId.value) return
  await moduleStore.updateItem(item.id, selectedModuleId.value, {
    enabled: item.enabled ? 0 : 1
  })
  await updatePreview()
}

async function handleExport(): Promise<void> {
  if (!selectedModuleId.value) return
  const data = await invokeIpc(IPC_CHANNELS.MODULE_EXPORT, {
    moduleId: selectedModuleId.value
  })
  if (data) {
    await navigator.clipboard.writeText(data)
    message.success(t('module.msg.copiedToClipboard'))
  }
}

async function handleImportModule(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    const result = await invokeIpc(IPC_CHANNELS.MODULE_IMPORT_DATA, {
      jsonData: text
    })
    if ('error' in result) {
      message.error(result.error)
    } else {
      await moduleStore.loadModules()
      message.success(t('module.msg.importSuccess', { name: result.name }))
    }
  } catch (error) {
    void error
    message.error(t('module.msg.importFailed'))
  }
}

async function handleReorderItems(): Promise<void> {
  if (!selectedModuleId.value) return
  const itemIds = moduleStore.currentItems.map((item) => item.id)
  await invokeIpc(IPC_CHANNELS.MODULE_ITEM_REORDER, { itemIds })
}

onMounted(() => {
  moduleStore.loadModules()
})
</script>

<template>
  <PageShell>
    <PageHeader :title="t('module.title')" :description="t('module.pageDescription')">
      <template #actions>
        <NButton size="small" @click="handleImportModule">{{
          t('module.importClipboard')
        }}</NButton>
        <NButton type="primary" @click="showCreateModal = true">
          {{ t('module.create') }}
        </NButton>
      </template>
    </PageHeader>

    <!-- Filter bar -->
    <div style="margin: 12px 0">
      <NSpace :size="4" :wrap="true">
        <NButton
          size="small"
          :type="!filterType ? 'primary' : 'default'"
          :tertiary="!!filterType"
          round
          @click="filterType = null"
          >{{ t('module.selectAll') }}</NButton
        >
        <NButton
          v-for="opt in moduleTypeOptions"
          :key="opt.value"
          size="small"
          :type="filterType === opt.value ? 'primary' : 'default'"
          :tertiary="filterType !== opt.value"
          round
          @click="filterType = opt.value"
          >{{ opt.label }}</NButton
        >
      </NSpace>
    </div>

    <div
      class="module-workspace"
      :class="{ 'module-workspace--selected': selectedModuleId && selectedModule }"
    >
      <section
        class="module-browser"
        :class="{ 'module-browser--compact': selectedModuleId && selectedModule }"
      >
        <div v-if="filteredModules.length > 0" class="module-grid">
          <NCard
            v-for="mod in filteredModules"
            :key="mod.id"
            size="small"
            hoverable
            class="interactive-card module-card"
            :class="{ 'module-card--selected': selectedModuleId === mod.id }"
            @click="selectModule(mod.id)"
          >
            <div class="module-card__header">
              <div class="module-card__copy">
                <NTooltip>
                  <template #trigger>
                    <div class="card-title module-card__title">{{ mod.name }}</div>
                  </template>
                  {{ mod.name }}
                </NTooltip>
                <NTooltip v-if="mod.description">
                  <template #trigger>
                    <div class="card-description module-card__description">
                      {{ mod.description }}
                    </div>
                  </template>
                  {{ mod.description }}
                </NTooltip>
              </div>
              <OverflowActionMenu
                :actions="getModuleActions()"
                :menu-label="t('common.moreActions')"
                :confirm-positive-text="t('common.delete')"
                :confirm-negative-text="t('common.cancel')"
                @select="(action) => handleModuleAction(action, mod)"
              />
            </div>
            <div class="module-card__footer">
              <NTag size="small" round>
                {{ t(`module.type.${mod.type}`) }}
              </NTag>
            </div>
          </NCard>
        </div>
        <ActionableEmptyState
          v-else
          :title="t('module.empty')"
          :description="t('module.emptyDescription')"
          :action-label="t('module.create')"
          @action="showCreateModal = true"
        />
      </section>

      <!-- Item detail panel -->
      <section v-if="selectedModuleId && selectedModule" class="module-detail">
        <NButton
          class="module-detail__back"
          size="small"
          quaternary
          @click="selectedModuleId = null"
        >
          <template #icon><NIcon :component="ArrowBackOutline" /></template>
          {{ t('module.backToModules') }}
        </NButton>
        <NCard :title="selectedModule.name" class="module-detail__card">
          <template #header-extra>
            <NSpace>
              <NButton size="small" @click="handleExport">{{ t('module.export') }}</NButton>
              <NButton type="primary" size="small" @click="openAddItem">
                {{ t('module.addItem') }}
              </NButton>
            </NSpace>
          </template>

          <!-- Items (draggable) -->
          <VueDraggable
            v-if="moduleStore.currentItems.length > 0"
            v-model="moduleStore.currentItems"
            handle=".drag-handle"
            :animation="200"
            @end="handleReorderItems"
          >
            <div v-for="item in moduleStore.currentItems" :key="item.id" class="module-item">
              <span class="drag-handle module-item__handle">⠿</span>
              <div class="module-item__content">
                <div class="module-item__header">
                  <span class="module-item__name">{{ item.name }}</span>
                  <div class="module-item__actions">
                    <NTag v-if="item.weight !== 1.0" size="tiny" round>w:{{ item.weight }}</NTag>
                    <span class="module-item__enabled-label">
                      {{ item.enabled ? t('module.itemEnabled') : t('module.itemDisabled') }}
                    </span>
                    <NTooltip>
                      <template #trigger>
                        <NSwitch
                          :value="!!item.enabled"
                          size="small"
                          :aria-label="
                            item.enabled ? t('module.itemEnabled') : t('module.itemDisabled')
                          "
                          @update:value="handleToggleItem(item)"
                        />
                      </template>
                      {{ item.enabled ? t('module.itemEnabled') : t('module.itemDisabled') }}
                    </NTooltip>
                    <NButton
                      size="tiny"
                      quaternary
                      circle
                      :title="t('common.edit')"
                      :aria-label="t('common.edit')"
                      @click="openEditItem(item)"
                    >
                      <template #icon><NIcon :component="PencilOutline" /></template>
                    </NButton>
                    <OverflowActionMenu
                      :actions="getItemActions()"
                      :menu-label="t('common.moreActions')"
                      :confirm-positive-text="t('common.delete')"
                      :confirm-negative-text="t('common.cancel')"
                      @select="(action) => handleItemAction(action, item)"
                    />
                  </div>
                </div>
                <div class="module-item__prompt">
                  {{ item.prompt.length > 80 ? item.prompt.substring(0, 80) + '...' : item.prompt }}
                </div>
              </div>
            </div>
          </VueDraggable>
          <NEmpty v-else :description="t('module.addItemsHint')" />

          <!-- Prompt Preview -->
          <template v-if="promptPreview && (promptPreview.positive || promptPreview.negative)">
            <NDivider>{{ t('module.promptPreview') }}</NDivider>
            <div
              v-if="promptPreview.positive"
              style="
                padding: 8px;
                border-radius: 4px;
                background: rgba(99, 226, 183, 0.1);
                margin-bottom: 8px;
                font-size: 13px;
                word-break: break-all;
              "
            >
              <strong>{{ promptPreviewLabels.positive }}:</strong> {{ promptPreview.positive }}
            </div>
            <div
              v-if="promptPreview.negative"
              style="
                padding: 8px;
                border-radius: 4px;
                background: rgba(255, 107, 107, 0.1);
                font-size: 13px;
                word-break: break-all;
              "
            >
              <strong>{{ promptPreviewLabels.negative }}:</strong> {{ promptPreview.negative }}
            </div>
          </template>
        </NCard>
      </section>
    </div>

    <!-- Create Module Modal -->
    <NModal
      v-model:show="showCreateModal"
      preset="card"
      style="width: 500px"
      :title="t('module.create')"
      :bordered="false"
    >
      <NForm>
        <NFormItem :label="t('common.name')">
          <NInput v-model:value="newModule.name" :placeholder="t('common.name')" />
        </NFormItem>
        <NFormItem :label="t('common.type')">
          <NSelect v-model:value="newModule.type" :options="moduleTypeOptions" />
        </NFormItem>
        <NFormItem :label="t('common.description')">
          <NInput
            v-model:value="newModule.description"
            type="textarea"
            :placeholder="t('common.description')"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :disabled="!newModule.name" @click="handleCreate">{{
            t('common.create')
          }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- Edit Module Modal -->
    <NModal
      v-model:show="showEditModuleModal"
      preset="card"
      style="width: 500px"
      :title="t('module.editModule')"
      :bordered="false"
    >
      <NForm>
        <NFormItem :label="t('common.name')">
          <NInput v-model:value="editModule.name" :placeholder="t('common.name')" />
        </NFormItem>
        <NFormItem :label="t('common.type')">
          <NSelect v-model:value="editModule.type" :options="moduleTypeOptions" />
        </NFormItem>
        <NFormItem :label="t('common.description')">
          <NInput
            v-model:value="editModule.description"
            type="textarea"
            :placeholder="t('common.description')"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showEditModuleModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :disabled="!editModule.name" @click="handleEditModule">{{
            t('common.save')
          }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- Edit Item Modal -->
    <NModal
      v-model:show="showItemModal"
      preset="card"
      style="width: 600px"
      :title="editingItem.isNew ? t('module.addItem') : t('common.edit')"
      :bordered="false"
    >
      <NForm>
        <NFormItem :label="t('common.name')">
          <NInput
            v-model:value="editingItem.name"
            :placeholder="t('module.item.namePlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('module.prompt')">
          <NInput
            v-model:value="editingItem.prompt"
            type="textarea"
            :rows="4"
            :placeholder="t('module.item.promptPlaceholder')"
          />
        </NFormItem>
        <!-- Prompt Variants -->
        <NDivider style="margin: 12px 0 8px">
          <span style="font-size: 12px; opacity: 0.7">{{ t('module.variant.title') }}</span>
        </NDivider>
        <div
          v-for="(variant, idx) in editingVariants"
          :key="idx"
          style="
            padding: 8px;
            border-radius: 8px;
            background: rgba(128, 128, 128, 0.06);
            margin-bottom: 8px;
          "
        >
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px">
            <NInput
              v-model:value="variant.name"
              size="small"
              :placeholder="t('module.item.variantNamePlaceholder')"
              style="flex: 1"
            />
            <NButton size="small" quaternary type="error" @click="removeVariant(idx)">
              {{ t('common.delete') }}
            </NButton>
          </div>
          <NInput
            v-model:value="variant.prompt"
            type="textarea"
            :rows="2"
            size="small"
            :placeholder="t('module.prompt')"
          />
        </div>
        <NButton size="small" dashed block style="margin-bottom: 12px" @click="addVariant">
          + {{ t('module.variant.add') }}
        </NButton>
        <NGrid :cols="2" :x-gap="12">
          <NGridItem>
            <NFormItem :label="t('module.weight')">
              <NInputNumber v-model:value="editingItem.weight" :min="0" :max="2" :step="0.05" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem :label="t('module.enabled')">
              <NSwitch
                v-model:value="editingItem.enabled"
                :checked-value="1"
                :unchecked-value="0"
              />
            </NFormItem>
          </NGridItem>
        </NGrid>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showItemModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" @click="handleSaveItem">{{ t('common.save') }}</NButton>
        </NSpace>
      </template>
    </NModal>
  </PageShell>
</template>

<style scoped>
.module-workspace {
  margin-top: 16px;
}

.module-workspace--selected {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.module-browser--compact .module-grid {
  grid-template-columns: 1fr;
}

.module-card {
  min-width: 0;
  cursor: pointer;
  border-radius: var(--radius-md);
}

.module-card--selected {
  border-color: var(--n-color-target, #63e2b7);
  box-shadow: inset 3px 0 0 #63e2b7;
}

.module-card__header,
.module-item__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.module-card__copy,
.module-item__content {
  min-width: 0;
  flex: 1;
}

.module-card__title,
.module-card__description {
  max-width: 100%;
}

.module-card__description {
  margin-top: 4px;
  min-height: 34px;
}

.module-browser--compact .module-card__description {
  min-height: 0;
  -webkit-line-clamp: 1;
}

.module-card__footer {
  display: flex;
  margin-top: 10px;
}

.module-detail {
  min-width: 0;
}

.module-detail__back {
  display: none;
  margin-bottom: 8px;
}

.module-detail__card {
  border-radius: var(--radius-md);
}

.module-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--app-surface-muted);
  margin-bottom: 7px;
}

.module-item__handle {
  cursor: grab;
  padding-right: 10px;
  color: var(--app-text-subtle);
  font-size: 16px;
}

.module-item__name {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-item__actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.module-item__enabled-label {
  color: var(--app-text-muted);
  font-size: 11px;
}

.module-item__prompt {
  overflow: hidden;
  margin-top: 3px;
  color: var(--app-text-subtle);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .module-workspace--selected {
    display: block;
  }

  .module-workspace--selected .module-browser {
    display: none;
  }

  .module-detail__back {
    display: inline-flex;
  }
}

@media (max-width: 720px) {
  .module-grid {
    grid-template-columns: 1fr;
  }

  .module-item__enabled-label {
    display: none;
  }
}
</style>
