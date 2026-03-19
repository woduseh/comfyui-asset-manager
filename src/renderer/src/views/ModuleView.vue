<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NEmpty, NSpace, NTag, NList, NListItem,
  NModal, NForm, NFormItem, NInput, NSelect, NThing
} from 'naive-ui'
import { useModuleStore, type PromptModule } from '@renderer/stores/module.store'

const { t } = useI18n()
const moduleStore = useModuleStore()
const showCreateModal = ref(false)
const newModule = ref({
  name: '',
  type: 'custom' as string,
  description: ''
})

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

const typeColors: Record<string, string> = {
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

async function handleCreate(): Promise<void> {
  if (!newModule.value.name) return
  await moduleStore.createModule(newModule.value)
  showCreateModal.value = false
  newModule.value = { name: '', type: 'custom', description: '' }
}

async function handleDelete(id: string): Promise<void> {
  await moduleStore.deleteModule(id)
}

function openCreateModal(): void {
  showCreateModal.value = true
}

onMounted(() => {
  moduleStore.loadModules()
})
</script>

<template>
  <div class="module-view">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>{{ t('module.title') }}</h2>
      <NButton type="primary" @click="openCreateModal">
        {{ t('module.create') }}
      </NButton>
    </div>

    <NCard style="margin-top: 16px;">
      <NList v-if="moduleStore.modules.length > 0" bordered>
        <NListItem v-for="mod in moduleStore.modules" :key="mod.id">
          <NThing :title="mod.name" :description="mod.description || undefined">
            <template #header-extra>
              <NSpace>
                <NTag :type="(typeColors[mod.type] || 'default') as 'success' | 'info' | 'warning' | 'error' | 'default'" size="small">
                  {{ t(`module.type.${mod.type}`) }}
                </NTag>
                <NButton size="small" quaternary type="error" @click="handleDelete(mod.id)">
                  {{ t('common.delete') }}
                </NButton>
              </NSpace>
            </template>
          </NThing>
        </NListItem>
      </NList>
      <NEmpty v-else :description="t('module.empty')" />
    </NCard>

    <NModal
      v-model:show="showCreateModal"
      preset="dialog"
      :title="t('module.create')"
      :positive-text="t('common.create')"
      :negative-text="t('common.cancel')"
      @positive-click="handleCreate"
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
    </NModal>
  </div>
</template>
