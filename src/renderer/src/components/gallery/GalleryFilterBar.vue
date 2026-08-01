<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NInput, NPopconfirm, NSelect, NSpace } from 'naive-ui'
import type { SelectMixedOption } from 'naive-ui/es/select/src/interface'

defineProps<{
  sortOptions: SelectMixedOption[]
  ratingOptions: SelectMixedOption[]
  selectionMode: boolean
  selectedCount: number
  hasActiveFilters: boolean
}>()

const searchText = defineModel<string>('searchText', { required: true })
const rating = defineModel<number | null>('rating', { required: true })
const favorite = defineModel<boolean | null>('favorite', { required: true })
const sortValue = defineModel<string>('sortValue', { required: true })

defineEmits<{
  search: []
  apply: []
  reset: []
  toggleSelection: []
  selectAll: []
  deleteSelected: []
}>()

const { t } = useI18n()
</script>

<template>
  <NCard size="small" style="margin-bottom: 16px">
    <NSpace align="center" :wrap="true" :size="12" class="gallery-filter-bar">
      <NInput
        v-model:value="searchText"
        size="small"
        clearable
        :placeholder="t('gallery.searchPlaceholder')"
        style="width: 200px"
        @update:value="$emit('search')"
        @clear="$emit('apply')"
      />
      <NSelect v-model:value="sortValue" :options="sortOptions" size="small" style="width: 160px" />
      <NSelect
        v-model:value="rating"
        :options="ratingOptions"
        size="small"
        style="width: 120px"
        :placeholder="t('gallery.ratingPlaceholder')"
        clearable
        @update:value="$emit('apply')"
      />
      <NButton
        size="small"
        :type="favorite ? 'warning' : 'default'"
        :tertiary="!favorite"
        round
        @click="favorite = favorite ? null : true"
      >
        {{ favorite ? t('gallery.favoriteOn') : t('gallery.favoriteOff') }}
      </NButton>
      <NButton v-if="hasActiveFilters" size="small" quaternary @click="$emit('reset')">
        {{ t('gallery.resetFilters') }}
      </NButton>
      <div style="flex: 1" />
      <NButton
        size="small"
        :type="selectionMode ? 'primary' : 'default'"
        @click="$emit('toggleSelection')"
      >
        {{ selectionMode ? t('gallery.selectionModeOff') : t('gallery.selectionModeOn') }}
      </NButton>
      <template v-if="selectionMode">
        <NButton size="small" @click="$emit('selectAll')">{{ t('gallery.selectAll') }}</NButton>
        <NPopconfirm @positive-click="$emit('deleteSelected')">
          <template #trigger>
            <NButton size="small" type="error" :disabled="selectedCount === 0">
              {{ t('gallery.deleteCount', { count: selectedCount }) }}
            </NButton>
          </template>
          {{ t('gallery.confirmBulkDelete', { count: selectedCount }) }}
        </NPopconfirm>
      </template>
    </NSpace>
  </NCard>
</template>
