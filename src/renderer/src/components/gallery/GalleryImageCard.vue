<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NCheckbox, NIcon, NRate } from 'naive-ui'
import { Heart, HeartOutline } from '@vicons/ionicons5'
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
  thumbnailFailed: []
  thumbnailLoaded: []
}>()

const { t } = useI18n()
</script>

<template>
  <NCard
    size="small"
    hoverable
    class="gallery-card"
    :class="{ 'gallery-card--selected': selected }"
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
      @failed="$emit('thumbnailFailed')"
      @loaded="$emit('thumbnailLoaded')"
    />
    <div class="gallery-card__actions">
      <NRate
        :value="image.rating"
        :count="5"
        size="small"
        :aria-label="t('gallery.rateImage')"
        @update:value="(value: number) => $emit('rate', value)"
      />
      <NButton
        quaternary
        circle
        size="small"
        :type="image.is_favorite ? 'warning' : 'default'"
        :aria-label="
          image.is_favorite ? t('gallery.viewer.removeFavorite') : t('gallery.viewer.addFavorite')
        "
        :aria-pressed="!!image.is_favorite"
        @click.stop="$emit('favorite')"
      >
        <template #icon>
          <NIcon :component="image.is_favorite ? Heart : HeartOutline" />
        </template>
      </NButton>
    </div>
    <div v-if="image.character_name" class="gallery-card__label">
      {{
        [image.character_name, image.outfit_name, image.emotion_name].filter(Boolean).join(' / ')
      }}
    </div>
  </NCard>
</template>

<style scoped>
.gallery-card {
  overflow: hidden;
  border-radius: var(--radius-lg);
  cursor: pointer;
}

.gallery-card--selected {
  box-shadow: 0 0 0 2px var(--app-accent-blue);
}

.gallery-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.gallery-card__label {
  margin-top: 4px;
  overflow: hidden;
  color: var(--app-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
