<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NCheckbox, NRate, NSpace } from 'naive-ui'
import type { GalleryImage } from '@renderer/stores/gallery.store'
import GalleryThumbnail from './GalleryThumbnail.vue'

defineProps<{
  image: GalleryImage
  selected: boolean
  selectionMode: boolean
  source: string
}>()

defineEmits<{
  open: []
  rate: [value: number]
  favorite: []
}>()

const { t } = useI18n()
</script>

<template>
  <NCard
    size="small"
    hoverable
    :style="{
      cursor: 'pointer',
      border: selected ? '2px solid #63e2b7' : undefined,
      borderRadius: '12px',
      overflow: 'hidden'
    }"
    @click="$emit('open')"
  >
    <template v-if="selectionMode" #header-extra>
      <NCheckbox :checked="selected" />
    </template>
    <GalleryThumbnail
      :src="source"
      :alt="image.character_name || image.file_path"
      :error-text="t('gallery.thumbnailLoadFailed')"
      :retry-text="t('common.retry')"
    />
    <NSpace justify="space-between" align="center" style="margin-top: 8px">
      <NRate
        :value="image.rating"
        :count="5"
        size="small"
        @update:value="(value: number) => $emit('rate', value)"
      />
      <NButton
        text
        :type="image.is_favorite ? 'warning' : 'default'"
        size="small"
        @click.stop="$emit('favorite')"
      >
        {{ image.is_favorite ? '♥' : '♡' }}
      </NButton>
    </NSpace>
    <div
      v-if="image.character_name"
      style="
        margin-top: 4px;
        font-size: 11px;
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      "
    >
      {{
        [image.character_name, image.outfit_name, image.emotion_name].filter(Boolean).join(' / ')
      }}
    </div>
  </NCard>
</template>
