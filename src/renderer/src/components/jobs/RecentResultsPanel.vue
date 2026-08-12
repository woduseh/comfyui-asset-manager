<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { FolderOpenOutline, ImagesOutline, OpenOutline, WarningOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NSkeleton } from 'naive-ui'
import GalleryThumbnail from '@renderer/components/gallery/GalleryThumbnail.vue'
import type { GalleryImage } from '@renderer/stores/gallery.store'
import { formatGalleryFileSize } from '@renderer/utils/gallery'
import { PRODUCTION_RECENT_RESULTS_LIMIT } from '@renderer/constants'

const props = defineProps<{
  images: GalleryImage[]
  loading: boolean
  loadError: boolean
}>()

defineEmits<{
  openExplorer: [filePath: string]
  retry: []
}>()

const { t } = useI18n()
const router = useRouter()
const selectedId = ref<string | null>(null)
const failedIds = ref<Set<string>>(new Set())
const displayImages = computed(() => props.images.filter((image) => !failedIds.value.has(image.id)))

watch(
  () => props.images,
  (images) => {
    failedIds.value = new Set()
    if (!images.length) selectedId.value = null
    else if (!images.some((image) => image.id === selectedId.value)) {
      selectedId.value = images[0].id
    }
  },
  { immediate: true }
)

const selectedImage = computed(
  () =>
    displayImages.value.find((image) => image.id === selectedId.value) ||
    displayImages.value[0] ||
    null
)

function hideFailedImage(id: string): void {
  failedIds.value = new Set([...failedIds.value, id])
  if (selectedId.value === id) selectedId.value = displayImages.value[0]?.id || null
}

function openSelectedResult(): void {
  if (!selectedImage.value) return
  void router.push({
    name: 'gallery',
    query: {
      imageId: selectedImage.value.id,
      fileName: selectedImage.value.file_path.split(/[\\/]/).pop() || undefined
    }
  })
}

function toFileUrl(path: string | undefined): string {
  return path ? 'local-asset://image/' + encodeURIComponent(path) : ''
}

function labelFor(image: GalleryImage): string {
  return (
    [image.character_name, image.outfit_name, image.emotion_name].filter(Boolean).join(' · ') ||
    image.file_path.split(/[\\/]/).pop() ||
    t('gallery.title')
  )
}
</script>

<template>
  <section class="results-panel" :aria-label="t('jobs.production.recentResults')">
    <header class="results-panel__header">
      <div>
        <span class="section-eyebrow">{{ t('jobs.production.liveOutput') }}</span>
        <h3>{{ t('jobs.production.recentResults') }}</h3>
      </div>
      <NButton size="small" quaternary @click="router.push({ name: 'gallery' })">
        {{ t('jobs.production.viewAll') }}
        <template #icon><NIcon :component="OpenOutline" /></template>
      </NButton>
    </header>

    <div v-if="loading && images.length === 0" class="results-panel__grid">
      <NSkeleton v-for="index in PRODUCTION_RECENT_RESULTS_LIMIT" :key="index" height="132px" />
    </div>

    <div v-else-if="loadError" class="results-panel__empty" role="alert">
      <NIcon :component="WarningOutline" :size="28" />
      <strong>{{ t('jobs.production.recentLoadFailed') }}</strong>
      <span>{{ t('jobs.production.recentLoadFailedHint') }}</span>
      <NButton size="small" secondary @click="$emit('retry')">
        {{ t('common.retry') }}
      </NButton>
    </div>

    <template v-else-if="displayImages.length > 0">
      <div class="results-panel__grid">
        <button
          v-for="image in displayImages.slice(0, PRODUCTION_RECENT_RESULTS_LIMIT)"
          :key="image.id"
          type="button"
          class="results-panel__thumb"
          :class="{ 'results-panel__thumb--selected': selectedImage?.id === image.id }"
          :aria-label="labelFor(image)"
          @click="selectedId = image.id"
        >
          <GalleryThumbnail
            :src="toFileUrl(image.thumbnail_path || image.file_path)"
            :alt="labelFor(image)"
            :error-text="t('gallery.thumbnailLoadFailed')"
            :retry-text="t('common.retry')"
            @failed="hideFailedImage(image.id)"
          />
        </button>
      </div>

      <div v-if="selectedImage" class="results-panel__inspector">
        <div class="results-panel__preview">
          <GalleryThumbnail
            :src="toFileUrl(selectedImage.thumbnail_path || selectedImage.file_path)"
            :alt="labelFor(selectedImage)"
            :error-text="t('gallery.thumbnailLoadFailed')"
            :retry-text="t('common.retry')"
            @failed="hideFailedImage(selectedImage.id)"
          />
        </div>
        <div class="results-panel__meta">
          <strong>{{ labelFor(selectedImage) }}</strong>
          <span class="results-panel__path" :title="selectedImage.file_path">
            {{ selectedImage.file_path.split(/[\\/]/).pop() }}
          </span>
          <dl>
            <div>
              <dt>{{ t('jobs.production.dimensions') }}</dt>
              <dd>{{ selectedImage.width || '—' }} × {{ selectedImage.height || '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('jobs.production.fileSize') }}</dt>
              <dd>{{ formatGalleryFileSize(selectedImage.file_size) }}</dd>
            </div>
          </dl>
          <div class="results-panel__actions">
            <NButton size="small" secondary type="primary" @click="openSelectedResult">
              <template #icon><NIcon :component="ImagesOutline" /></template>
              {{ t('jobs.production.openResult') }}
            </NButton>
            <NButton
              size="small"
              quaternary
              @click="$emit('openExplorer', selectedImage.file_path)"
            >
              <template #icon><NIcon :component="FolderOpenOutline" /></template>
              {{ t('gallery.viewer.openInExplorer') }}
            </NButton>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="results-panel__empty">
      <NIcon :component="ImagesOutline" :size="28" />
      <strong>{{ t('jobs.production.noRecentResults') }}</strong>
      <span>{{ t('jobs.production.noRecentResultsHint') }}</span>
      <NButton v-if="images.length > 0" size="small" secondary @click="$emit('retry')">
        {{ t('common.retry') }}
      </NButton>
    </div>
  </section>
</template>

<style scoped>
.results-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-left: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}

.results-panel__header {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--app-border);
}

.results-panel__header h3 {
  margin: 3px 0 0;
  font-size: 18px;
}

.results-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 16px;
}

.results-panel__thumb {
  min-width: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  outline: none;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
}

.results-panel__thumb--selected,
.results-panel__thumb:focus-visible {
  border-color: var(--app-accent-blue);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-accent-blue) 32%, transparent);
}

.results-panel__thumb :deep(.gallery-thumbnail) {
  border-radius: 5px;
}

.results-panel__inspector {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr);
  gap: 16px;
  margin-top: auto;
  padding: 18px 20px;
  border-top: 1px solid var(--app-border);
}

.results-panel__preview {
  align-self: start;
}

.results-panel__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.results-panel__meta strong {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.results-panel__path {
  overflow: hidden;
  color: var(--app-text-subtle);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.results-panel__meta dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 4px 0;
}

.results-panel__meta dl div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.results-panel__meta dt {
  color: var(--app-text-subtle);
  font-size: 10px;
}

.results-panel__meta dd {
  margin: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.results-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.results-panel__empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  padding: 48px 24px;
  color: var(--app-text-subtle);
  text-align: center;
}

.results-panel__empty span {
  max-width: 280px;
  font-size: 12px;
}

@media (max-width: 1180px) {
  .results-panel {
    border-top: 1px solid var(--app-border);
    border-left: 0;
  }

  .results-panel__grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .results-panel__grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
