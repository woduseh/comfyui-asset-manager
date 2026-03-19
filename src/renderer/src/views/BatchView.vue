<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NModal, NForm, NFormItem,
  NInput, NSelect, NInputNumber, NDataTable, NGrid, NGridItem,
  NDivider, NStatistic, NCheckboxGroup, NCheckbox, NAlert,
  NScrollbar, useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import { useModuleStore, type PromptModule, type ModuleItem } from '@renderer/stores/module.store'
import { useWorkflowStore, type WorkflowItem } from '@renderer/stores/workflow.store'

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
    width: 150,
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
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
    const result = await window.electron.ipcRenderer.invoke('batch:create', {
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
      fileNamePattern: filePattern.value
    })

    message.success(`배치 작업 생성 완료: ${result.totalTasks}개 태스크`)
    showBuilderModal.value = false
    await loadBatchJobs()
  } catch (error) {
    message.error('배치 작업 생성 실패: ' + (error as Error).message)
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
