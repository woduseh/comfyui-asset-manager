<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NList, NListItem,
  NModal, NForm, NFormItem, NInput, NSelect, NThing,
  NInputNumber, NSwitch, NGrid, NGridItem, NDivider,
  NCollapse, NCollapseItem, NPopconfirm, useMessage
} from 'naive-ui'
import { useModuleStore, type PromptModule, type ModuleItem } from '@renderer/stores/module.store'

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

// Prompt preview
const promptPreview = ref<{ positive: string; negative: string } | null>(null)

const moduleTypeOptions = [
  { label: t('module.type.character'), value: 'character' },
  { label: t('module.type.outfit'), value: 'outfit' },
  { label: t('module.type.emotion'), value: 'emotion' },
  { label: t('module.type.style'), value: 'style' },
  { label: t('module.type.artist'), value: 'artist' },
  { label: t('module.type.quality'), value: 'quality' },
  { label: t('module.type.negative'), value: 'negative' },
  { label: t('module.type.lora'), value: 'lora' },
  { label: t('module.type.custom'), value: 'custom' }
]

const typeColors: Record<string, 'success' | 'info' | 'warning' | 'error' | 'default'> = {
  character: 'success',
  outfit: 'info',
  emotion: 'warning',
  style: 'error',
  artist: 'default',
  quality: 'success',
  negative: 'error',
  lora: 'info',
  custom: 'default'
}

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
    promptPreview.value = await window.electron.ipcRenderer.invoke('prompt:preview', {
      moduleIds: [selectedModuleId.value]
    })
  } catch {
    promptPreview.value = null
  }
}

async function handleCreate(): Promise<void> {
  if (!newModule.value.name) return
  try {
    await moduleStore.createModule(newModule.value)
    showCreateModal.value = false
    newModule.value = { name: '', type: 'custom', description: '' }
    message.success('모듈이 생성되었습니다')
  } catch (e) {
    message.error(`모듈 생성 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function handleDeleteModule(id: string): Promise<void> {
  if (selectedModuleId.value === id) selectedModuleId.value = null
  await moduleStore.deleteModule(id)
  message.success('삭제되었습니다')
}

function selectModule(id: string): void {
  selectedModuleId.value = selectedModuleId.value === id ? null : id
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
    enabled: 1
  }
  showItemModal.value = true
}

function openEditItem(item: ModuleItem): void {
  editingItem.value = { ...item, isNew: false }
  showItemModal.value = true
}

async function handleSaveItem(): Promise<void> {
  const item = editingItem.value
  if (!item.name || !item.prompt) {
    message.warning('이름과 프롬프트를 입력해주세요')
    return
  }

  if (item.isNew && selectedModuleId.value) {
    await moduleStore.createItem({
      module_id: selectedModuleId.value,
      name: item.name!,
      prompt: item.prompt!,
      negative: item.negative,
      weight: item.weight,
      sort_order: item.sort_order
    })
    message.success('아이템이 추가되었습니다')
  } else if (item.id && selectedModuleId.value) {
    await moduleStore.updateItem(item.id, selectedModuleId.value, {
      name: item.name,
      prompt: item.prompt,
      negative: item.negative,
      weight: item.weight,
      sort_order: item.sort_order,
      enabled: item.enabled
    })
    message.success('아이템이 수정되었습니다')
  }

  showItemModal.value = false
  await updatePreview()
}

async function handleDeleteItem(item: ModuleItem): Promise<void> {
  if (!selectedModuleId.value) return
  await moduleStore.deleteItem(item.id, selectedModuleId.value)
  message.success('아이템이 삭제되었습니다')
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
  const data = await window.electron.ipcRenderer.invoke('module:export', {
    moduleId: selectedModuleId.value
  })
  if (data) {
    await navigator.clipboard.writeText(data)
    message.success('클립보드에 복사되었습니다')
  }
}

async function handleImportModule(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    const result = await window.electron.ipcRenderer.invoke('module:import-data', { jsonData: text })
    if (result.error) {
      message.error(result.error)
    } else {
      await moduleStore.loadModules()
      message.success(`모듈 "${result.name}" 가져오기 완료`)
    }
  } catch {
    message.error('클립보드에서 모듈 데이터를 읽을 수 없습니다')
  }
}

onMounted(() => {
  moduleStore.loadModules()
})
</script>

<template>
  <div class="module-view">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>{{ t('module.title') }}</h2>
      <NSpace>
        <NButton size="small" @click="handleImportModule">가져오기 (클립보드)</NButton>
        <NButton type="primary" @click="showCreateModal = true">
          {{ t('module.create') }}
        </NButton>
      </NSpace>
    </div>

    <!-- Filter bar -->
    <NSpace style="margin-top: 12px;">
      <NButton
        size="small"
        :type="!filterType ? 'primary' : 'default'"
        @click="filterType = null"
      >전체</NButton>
      <NButton
        v-for="opt in moduleTypeOptions"
        :key="opt.value"
        size="small"
        :type="filterType === opt.value ? 'primary' : 'default'"
        @click="filterType = opt.value"
      >{{ opt.label }}</NButton>
    </NSpace>

    <NGrid :cols="selectedModuleId ? 2 : 1" :x-gap="16" style="margin-top: 16px;">
      <!-- Module list -->
      <NGridItem>
        <NCard title="모듈 목록">
          <NList v-if="filteredModules.length > 0" bordered clickable>
            <NListItem
              v-for="mod in filteredModules"
              :key="mod.id"
              :style="{ backgroundColor: selectedModuleId === mod.id ? 'rgba(99, 226, 183, 0.1)' : undefined, cursor: 'pointer' }"
              @click="selectModule(mod.id)"
            >
              <NThing :title="mod.name" :description="mod.description || undefined">
                <template #header-extra>
                  <NSpace>
                    <NTag :type="typeColors[mod.type] || 'default'" size="small">
                      {{ t(`module.type.${mod.type}`) }}
                    </NTag>
                    <NPopconfirm @positive-click="handleDeleteModule(mod.id)">
                      <template #trigger>
                        <NButton size="tiny" quaternary type="error" @click.stop>
                          {{ t('common.delete') }}
                        </NButton>
                      </template>
                      삭제하시겠습니까?
                    </NPopconfirm>
                  </NSpace>
                </template>
              </NThing>
            </NListItem>
          </NList>
          <NEmpty v-else :description="t('module.empty')" />
        </NCard>
      </NGridItem>

      <!-- Item detail panel -->
      <NGridItem v-if="selectedModuleId && selectedModule">
        <NCard :title="selectedModule.name">
          <template #header-extra>
            <NSpace>
              <NButton size="small" @click="handleExport">내보내기</NButton>
              <NButton type="primary" size="small" @click="openAddItem">
                {{ t('module.addItem') }}
              </NButton>
            </NSpace>
          </template>

          <!-- Items -->
          <NList v-if="moduleStore.currentItems.length > 0" bordered>
            <NListItem v-for="item in moduleStore.currentItems" :key="item.id">
              <NThing
                :title="item.name"
                :description="item.prompt.length > 80 ? item.prompt.substring(0, 80) + '...' : item.prompt"
              >
                <template #header-extra>
                  <NSpace align="center" :size="4">
                    <NTag v-if="item.weight !== 1.0" size="tiny" round>w:{{ item.weight }}</NTag>
                    <NSwitch
                      :value="!!item.enabled"
                      size="small"
                      @update:value="handleToggleItem(item)"
                    />
                    <NButton size="tiny" quaternary @click="openEditItem(item)">
                      {{ t('common.edit') }}
                    </NButton>
                    <NPopconfirm @positive-click="handleDeleteItem(item)">
                      <template #trigger>
                        <NButton size="tiny" quaternary type="error">
                          {{ t('common.delete') }}
                        </NButton>
                      </template>
                      삭제하시겠습니까?
                    </NPopconfirm>
                  </NSpace>
                </template>
              </NThing>
            </NListItem>
          </NList>
          <NEmpty v-else description="아이템을 추가하세요" />

          <!-- Prompt Preview -->
          <template v-if="promptPreview && (promptPreview.positive || promptPreview.negative)">
            <NDivider>프롬프트 미리보기</NDivider>
            <div v-if="promptPreview.positive" style="padding: 8px; border-radius: 4px; background: rgba(99, 226, 183, 0.1); margin-bottom: 8px; font-size: 13px; word-break: break-all;">
              <strong>Positive:</strong> {{ promptPreview.positive }}
            </div>
            <div v-if="promptPreview.negative" style="padding: 8px; border-radius: 4px; background: rgba(255, 107, 107, 0.1); font-size: 13px; word-break: break-all;">
              <strong>Negative:</strong> {{ promptPreview.negative }}
            </div>
          </template>
        </NCard>
      </NGridItem>
    </NGrid>

    <!-- Create Module Modal -->
    <NModal
      v-model:show="showCreateModal"
      preset="card"
      style="width: 500px;"
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
          <NInput v-model:value="newModule.description" type="textarea" :placeholder="t('common.description')" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :disabled="!newModule.name" @click="handleCreate">{{ t('common.create') }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- Edit Item Modal -->
    <NModal
      v-model:show="showItemModal"
      preset="card"
      style="width: 600px;"
      :title="editingItem.isNew ? t('module.addItem') : t('common.edit')"
      :bordered="false"
    >
      <NForm>
        <NFormItem :label="t('common.name')">
          <NInput v-model:value="editingItem.name" placeholder="아이템 이름" />
        </NFormItem>
        <NFormItem :label="t('module.prompt')">
          <NInput
            v-model:value="editingItem.prompt"
            type="textarea"
            :rows="4"
            placeholder="프롬프트 입력... 와일드카드 사용 가능: {red|blue|green}, 변수: {{character_name}}"
          />
        </NFormItem>
        <NFormItem :label="t('module.negative')">
          <NInput
            v-model:value="editingItem.negative"
            type="textarea"
            :rows="2"
            placeholder="네거티브 프롬프트 (선택사항)"
          />
        </NFormItem>
        <NGrid :cols="2" :x-gap="12">
          <NGridItem>
            <NFormItem :label="t('module.weight')">
              <NInputNumber v-model:value="editingItem.weight" :min="0" :max="2" :step="0.05" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="활성화">
              <NSwitch v-model:value="editingItem.enabled" :checked-value="1" :unchecked-value="0" />
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
  </div>
</template>
