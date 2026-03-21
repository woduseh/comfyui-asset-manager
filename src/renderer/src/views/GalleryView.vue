<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NEmpty,
  NGrid,
  NGridItem,
  NImage,
  NSpace,
  NRate,
  NButton,
  NTag,
  NSelect,
  NPagination,
  NModal,
  NCheckbox,
  NDivider,
  NPopconfirm,
  useMessage,
  NTooltip,
  NCollapse,
  NCollapseItem
} from 'naive-ui'
import type { SelectMixedOption } from 'naive-ui/es/select/src/interface'
import { useGalleryStore, type GalleryImage } from '@renderer/stores/gallery.store'
import { useQueueStore } from '@renderer/stores/queue.store'

const { t } = useI18n()
const message = useMessage()
const galleryStore = useGalleryStore()
const queueStore = useQueueStore()

// Filters
const filterCharacter = ref<string | null>(null)
const filterOutfit = ref<string | null>(null)
const filterEmotion = ref<string | null>(null)
const filterRating = ref<number | null>(null)
const filterFavorite = ref<boolean | null>(null)
const sortBy = ref<'created_at' | 'rating' | 'file_size'>('created_at')
const sortOrder = ref<'asc' | 'desc'>('desc')

// Detail modal
const showDetail = ref(false)
const detailIndex = ref(-1)

const detailImage = computed<GalleryImage | null>(() => {
  if (detailIndex.value < 0 || detailIndex.value >= galleryStore.images.length) return null
  return galleryStore.images[detailIndex.value]
})

const canGoPrev = computed(() => detailIndex.value > 0)
const canGoNext = computed(() => detailIndex.value < galleryStore.images.length - 1)
const positionLabel = computed(() => {
  if (!detailImage.value) return ''
  const globalIndex = (galleryStore.page - 1) * galleryStore.pageSize + detailIndex.value + 1
  return `${globalIndex} / ${galleryStore.total}`
})

// Selection mode
const selectionMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toFileUrl(path: string | undefined): string {
  if (!path) return ''
  return 'local-asset://image/' + encodeURIComponent(path)
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function parseGenerationParams(json: string | null): Record<string, unknown> | null {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const sortOptions = [
  { label: t('gallery.sortOptions.createdDesc'), value: 'created_at:desc' },
  { label: t('gallery.sortOptions.createdAsc'), value: 'created_at:asc' },
  { label: t('gallery.sortOptions.ratingDesc'), value: 'rating:desc' },
  { label: t('gallery.sortOptions.ratingAsc'), value: 'rating:asc' }
]

const ratingOptions: SelectMixedOption[] = [
  { label: t('gallery.all'), value: null as unknown as string },
  { label: '⭐ 1+', value: 1 },
  { label: '⭐⭐ 2+', value: 2 },
  { label: '⭐⭐⭐ 3+', value: 3 },
  { label: '⭐⭐⭐⭐ 4+', value: 4 },
  { label: '⭐⭐⭐⭐⭐ 5', value: 5 }
]

const totalPages = computed(() => Math.ceil(galleryStore.total / galleryStore.pageSize))

// Apply filters
function applyFilters(): void {
  galleryStore.setFilters({
    characterName: filterCharacter.value || undefined,
    outfitName: filterOutfit.value || undefined,
    emotionName: filterEmotion.value || undefined,
    minRating: filterRating.value || undefined,
    isFavorite: filterFavorite.value || undefined,
    sortBy: sortBy.value,
    sortOrder: sortOrder.value
  })
  galleryStore.loadImages()
}

function handleSortChange(val: string): void {
  const [field, order] = val.split(':')
  sortBy.value = field as 'created_at' | 'rating' | 'file_size'
  sortOrder.value = order as 'asc' | 'desc'
  applyFilters()
}

function clearFilters(): void {
  filterCharacter.value = null
  filterOutfit.value = null
  filterEmotion.value = null
  filterRating.value = null
  filterFavorite.value = null
  sortBy.value = 'created_at'
  sortOrder.value = 'desc'
  applyFilters()
}

function openDetail(image: GalleryImage): void {
  if (selectionMode.value) {
    toggleSelection(image.id)
    return
  }
  const idx = galleryStore.images.findIndex((i) => i.id === image.id)
  detailIndex.value = idx >= 0 ? idx : 0
  showDetail.value = true
}

function goToPrev(): void {
  if (canGoPrev.value) detailIndex.value--
}

function goToNext(): void {
  if (canGoNext.value) detailIndex.value++
}

function toggleSelection(id: string): void {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  selectedIds.value = new Set(selectedIds.value) // trigger reactivity
}

function toggleSelectionMode(): void {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) selectedIds.value = new Set()
}

function selectAll(): void {
  for (const img of galleryStore.images) {
    selectedIds.value.add(img.id)
  }
  selectedIds.value = new Set(selectedIds.value)
}

async function deleteSelected(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  await galleryStore.deleteImages(ids)
  selectedIds.value = new Set()
  message.success(t('gallery.msg.bulkDeleted', { count: ids.length }))
}

async function handleToggleFavorite(image: GalleryImage): Promise<void> {
  await galleryStore.toggleFavorite(image.id)
}

async function handleCopyToClipboard(): Promise<void> {
  if (!detailImage.value) return
  const success = await galleryStore.copyToClipboard(detailImage.value.file_path)
  if (success) {
    message.success(t('gallery.msg.copiedToClipboard'))
  } else {
    message.error(t('gallery.msg.copyFailed'))
  }
}

async function handleShowInExplorer(): Promise<void> {
  if (!detailImage.value) return
  await galleryStore.showInExplorer(detailImage.value.file_path)
}

async function handleDeleteFromDetail(): Promise<void> {
  if (!detailImage.value) return
  const id = detailImage.value.id
  const hadNext = canGoNext.value

  await galleryStore.deleteImages([id])
  message.success(t('gallery.msg.imageDeleted'))

  if (galleryStore.images.length === 0) {
    showDetail.value = false
    detailIndex.value = -1
  } else if (!hadNext && detailIndex.value > 0) {
    detailIndex.value--
  }
  // else: detailIndex stays the same, pointing at the next image that shifted into position
}

// Keyboard navigation for detail modal
function handleKeydown(e: KeyboardEvent): void {
  if (!showDetail.value) return

  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    goToPrev()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    goToNext()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    showDetail.value = false
  } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    handleCopyToClipboard()
  }
}

function handlePageChange(p: number): void {
  galleryStore.setPage(p)
  galleryStore.loadImages()
}

watch(filterFavorite, () => applyFilters())

// Register keyboard handler when detail modal opens
watch(showDetail, (val) => {
  if (val) {
    window.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('keydown', handleKeydown)
  }
})

// Auto-refresh gallery when tasks complete (debounced to avoid excessive reloads)
let galleryRefreshTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => queueStore.activeJobs.reduce((sum, j) => sum + j.completedTasks, 0),
  () => {
    if (galleryRefreshTimer) clearTimeout(galleryRefreshTimer)
    galleryRefreshTimer = setTimeout(() => galleryStore.loadImages(), 2000)
  }
)

onMounted(() => {
  galleryStore.loadImages()
})

onUnmounted(() => {
  if (galleryRefreshTimer) clearTimeout(galleryRefreshTimer)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="gallery-view">
    <div
      style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      "
    >
      <h2 style="margin: 0">
        {{ t('gallery.title') }}
        <NTag v-if="galleryStore.total > 0" size="small" round style="margin-left: 8px">{{
          galleryStore.total
        }}</NTag>
      </h2>
    </div>

    <!-- Filter bar -->
    <NCard size="small" style="margin-bottom: 16px">
      <NSpace align="center" :wrap="false" :size="12">
        <NSelect
          :value="sortBy + ':' + sortOrder"
          :options="sortOptions"
          size="small"
          style="width: 160px"
          @update:value="handleSortChange"
        />
        <NSelect
          v-model:value="filterRating"
          :options="ratingOptions"
          size="small"
          style="width: 120px"
          :placeholder="t('gallery.ratingPlaceholder')"
          clearable
          @update:value="applyFilters"
        />
        <NButton
          size="small"
          :type="filterFavorite ? 'warning' : 'default'"
          :tertiary="!filterFavorite"
          round
          @click="filterFavorite = filterFavorite ? null : true"
        >
          {{ filterFavorite ? t('gallery.favoriteOn') : t('gallery.favoriteOff') }}
        </NButton>
        <NButton
          v-if="filterRating || filterFavorite"
          size="small"
          quaternary
          @click="clearFilters"
        >
          {{ t('gallery.resetFilters') }}
        </NButton>
        <div style="flex: 1" />
        <NButton
          size="small"
          :type="selectionMode ? 'primary' : 'default'"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? t('gallery.selectionModeOff') : t('gallery.selectionModeOn') }}
        </NButton>
        <template v-if="selectionMode">
          <NButton size="small" @click="selectAll">{{ t('gallery.selectAll') }}</NButton>
          <NPopconfirm @positive-click="deleteSelected">
            <template #trigger>
              <NButton size="small" type="error" :disabled="selectedIds.size === 0">
                {{ t('gallery.deleteCount', { count: selectedIds.size }) }}
              </NButton>
            </template>
            {{ t('gallery.confirmBulkDelete', { count: selectedIds.size }) }}
          </NPopconfirm>
        </template>
      </NSpace>
    </NCard>

    <!-- Image grid -->
    <NCard style="margin-top: 0">
      <template v-if="galleryStore.images.length > 0">
        <NGrid
          :cols="5"
          :x-gap="12"
          :y-gap="12"
          responsive="screen"
          :cols-s="2"
          :cols-m="3"
          :cols-l="4"
          :cols-xl="5"
        >
          <NGridItem v-for="image in galleryStore.images" :key="image.id">
            <NCard
              size="small"
              hoverable
              :style="{
                cursor: 'pointer',
                border: selectedIds.has(image.id) ? '2px solid #63e2b7' : undefined,
                borderRadius: '12px',
                overflow: 'hidden'
              }"
              @click="openDetail(image)"
            >
              <template v-if="selectionMode" #header-extra>
                <NCheckbox :checked="selectedIds.has(image.id)" />
              </template>
              <NImage
                :src="toFileUrl(image.thumbnail_path || image.file_path)"
                :width="200"
                object-fit="cover"
                style="aspect-ratio: 1; border-radius: 8px; width: 100%"
                preview-disabled
              />
              <NSpace justify="space-between" align="center" style="margin-top: 8px">
                <NRate
                  :value="image.rating"
                  :count="5"
                  size="small"
                  @update:value="(val: number) => galleryStore.rateImage(image.id, val)"
                />
                <NButton
                  text
                  :type="image.is_favorite ? 'warning' : 'default'"
                  size="small"
                  @click.stop="handleToggleFavorite(image)"
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
                  [image.character_name, image.outfit_name, image.emotion_name]
                    .filter(Boolean)
                    .join(' / ')
                }}
              </div>
            </NCard>
          </NGridItem>
        </NGrid>

        <NDivider />
        <NSpace justify="center">
          <NPagination
            :page="galleryStore.page"
            :page-count="totalPages"
            :page-size="galleryStore.pageSize"
            @update:page="handlePageChange"
          />
        </NSpace>
      </template>
      <NEmpty v-else :description="t('gallery.empty')" />
    </NCard>

    <!-- Detail Modal -->
    <NModal
      v-model:show="showDetail"
      :mask-closable="true"
      :close-on-esc="false"
      style="padding: 0"
      transform-origin="center"
    >
      <div v-if="detailImage" class="detail-overlay" @click.self="showDetail = false">
        <!-- Navigation: Previous -->
        <button
          class="nav-btn nav-prev"
          :disabled="!canGoPrev"
          :title="t('gallery.viewer.prevImage')"
          @click="goToPrev"
        >
          ‹
        </button>

        <!-- Main content -->
        <div class="detail-container">
          <!-- Top bar -->
          <div class="detail-topbar">
            <span class="detail-position">{{ positionLabel }}</span>
            <div class="detail-actions">
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="small" @click="handleCopyToClipboard">
                    📋
                  </NButton>
                </template>
                {{ t('gallery.viewer.copyToClipboard') }}
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="small" @click="handleShowInExplorer">
                    📂
                  </NButton>
                </template>
                {{ t('gallery.viewer.openInExplorer') }}
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton
                    quaternary
                    circle
                    size="small"
                    :type="detailImage.is_favorite ? 'warning' : 'default'"
                    @click="
                      () => {
                        handleToggleFavorite(detailImage!)
                        detailImage!.is_favorite = detailImage!.is_favorite ? 0 : 1
                      }
                    "
                  >
                    {{ detailImage.is_favorite ? '♥' : '♡' }}
                  </NButton>
                </template>
                {{
                  detailImage.is_favorite
                    ? t('gallery.viewer.removeFavorite')
                    : t('gallery.viewer.addFavorite')
                }}
              </NTooltip>
              <NPopconfirm
                :positive-text="t('common.delete')"
                :negative-text="t('common.cancel')"
                @positive-click="handleDeleteFromDetail"
              >
                <template #trigger>
                  <NTooltip>
                    <template #trigger>
                      <NButton quaternary circle size="small" type="error"> 🗑️ </NButton>
                    </template>
                    {{ t('gallery.viewer.deleteImage') }}
                  </NTooltip>
                </template>
                {{ t('gallery.viewer.confirmDelete') }}
              </NPopconfirm>
              <NButton
                quaternary
                circle
                size="small"
                style="margin-left: 8px"
                @click="showDetail = false"
              >
                ✕
              </NButton>
            </div>
          </div>

          <!-- Image area -->
          <div class="detail-body">
            <!-- Image section -->
            <div class="detail-image-section">
              <div class="detail-image-area">
                <NImage
                  :src="toFileUrl(detailImage.file_path)"
                  object-fit="contain"
                  style="max-height: 75vh; max-width: 100%; border-radius: 8px"
                  :preview-disabled="false"
                />
              </div>
              <div class="detail-image-meta">
                {{ formatFileSize(detailImage.file_size) }}
                <template v-if="detailImage.width && detailImage.height">
                  · {{ detailImage.width }}×{{ detailImage.height }}
                </template>
                · {{ detailImage.created_at?.split('T')[0] || detailImage.created_at }}
              </div>
            </div>

            <!-- Sidebar: metadata -->
            <div class="detail-sidebar">
              <div class="sidebar-section">
                <NRate
                  :value="detailImage.rating"
                  :count="5"
                  size="small"
                  @update:value="
                    (val: number) => {
                      galleryStore.rateImage(detailImage!.id, val)
                      detailImage!.rating = val
                    }
                  "
                />
              </div>

              <!-- Metadata table -->
              <div
                v-if="
                  detailImage.character_name ||
                  detailImage.outfit_name ||
                  detailImage.emotion_name ||
                  detailImage.style_name
                "
                class="sidebar-section detail-metadata"
              >
                <div v-if="detailImage.character_name" class="metadata-item">
                  <span class="metadata-label">{{ t('gallery.meta.character') }}</span>
                  <span class="metadata-value">{{ detailImage.character_name }}</span>
                </div>
                <div v-if="detailImage.outfit_name" class="metadata-item">
                  <span class="metadata-label">{{ t('gallery.meta.outfit') }}</span>
                  <span class="metadata-value">{{ detailImage.outfit_name }}</span>
                </div>
                <div v-if="detailImage.emotion_name" class="metadata-item">
                  <span class="metadata-label">{{ t('gallery.meta.emotion') }}</span>
                  <span class="metadata-value">{{ detailImage.emotion_name }}</span>
                </div>
                <div v-if="detailImage.style_name" class="metadata-item">
                  <span class="metadata-label">{{ t('gallery.meta.style') }}</span>
                  <span class="metadata-value">{{ detailImage.style_name }}</span>
                </div>
              </div>

              <!-- File path -->
              <div class="sidebar-section detail-filepath">
                <span class="metadata-label">{{ t('gallery.meta.file') }}</span>
                <span class="filepath-text" :title="detailImage.file_path">{{
                  detailImage.file_path
                }}</span>
              </div>

              <!-- Prompt info (collapsible) -->
              <NCollapse
                v-if="
                  detailImage.prompt_text ||
                  detailImage.negative_text ||
                  detailImage.generation_params
                "
                class="sidebar-section"
              >
                <NCollapseItem :title="t('gallery.promptInfo')" name="prompt">
                  <div v-if="detailImage.prompt_text" class="prompt-block">
                    <div class="prompt-label">Positive</div>
                    <div class="prompt-text">{{ detailImage.prompt_text }}</div>
                  </div>
                  <div v-if="detailImage.negative_text" class="prompt-block">
                    <div class="prompt-label">Negative</div>
                    <div class="prompt-text negative">{{ detailImage.negative_text }}</div>
                  </div>
                  <div
                    v-if="parseGenerationParams(detailImage.generation_params)"
                    class="prompt-block"
                  >
                    <div class="prompt-label">Parameters</div>
                    <div class="prompt-text params">
                      <template
                        v-for="(value, key) in parseGenerationParams(detailImage.generation_params)"
                        :key="key"
                      >
                        <NTag size="tiny" round style="margin: 2px">{{ key }}: {{ value }}</NTag>
                      </template>
                    </div>
                  </div>
                </NCollapseItem>
              </NCollapse>
            </div>
          </div>
        </div>

        <!-- Navigation: Next -->
        <button
          class="nav-btn nav-next"
          :disabled="!canGoNext"
          :title="t('gallery.viewer.nextImage')"
          @click="goToNext"
        >
          ›
        </button>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.detail-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  gap: 16px;
}

.nav-btn {
  width: 48px;
  height: 80px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  font-size: 32px;
  cursor: pointer;
  border-radius: 12px;
  transition:
    background 0.2s,
    opacity 0.2s;
  flex-shrink: 0;
}
.nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}
.nav-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

.detail-container {
  background: var(--n-color, #1e1e2e);
  border-radius: 12px;
  max-width: 1200px;
  width: 92vw;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.detail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.detail-position {
  font-size: 13px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.detail-image-area {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  padding: 16px;
}

.detail-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.detail-sidebar {
  width: 300px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-section {
  padding: 8px 0;
}

.detail-image-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
}

.detail-image-meta {
  font-size: 12px;
  opacity: 0.55;
  padding: 8px 16px 12px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.detail-info-panel {
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.detail-metadata {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}
.metadata-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.metadata-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.45;
  flex-shrink: 0;
  min-width: 40px;
}
.metadata-value {
  font-size: 12px;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-filepath {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}
.filepath-text {
  font-size: 11px;
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  word-break: break-all;
}

.prompt-block {
  margin-bottom: 8px;
}
.prompt-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.5;
  margin-bottom: 4px;
  text-transform: uppercase;
}
.prompt-text {
  font-size: 12px;
  line-height: 1.6;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  word-break: break-word;
  white-space: pre-wrap;
}
.prompt-text.negative {
  border-left: 3px solid rgba(255, 100, 100, 0.4);
}
.prompt-text.params {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
}

@media (max-width: 768px) {
  .detail-body {
    flex-direction: column;
  }
  .detail-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    max-height: 200px;
  }
}
</style>
