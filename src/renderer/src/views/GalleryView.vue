<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NGrid,
  NGridItem,
  NImage,
  NSpace,
  NRate,
  NButton,
  NTag,
  NPagination,
  NModal,
  NDivider,
  NPopconfirm,
  useMessage,
  NTooltip,
  NCollapse,
  NCollapseItem,
  NSkeleton,
  NAlert
} from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import type { SelectMixedOption } from 'naive-ui/es/select/src/interface'
import { useGalleryStore, type GalleryImage } from '@renderer/stores/gallery.store'
import { useQueueStore } from '@renderer/stores/queue.store'
import { GALLERY_BATCH_REFRESH_DEBOUNCE_MS } from '@renderer/constants'
import { buildGalleryRatingOptions, buildGallerySortOptions } from '@renderer/utils/view-labels'
import { formatGalleryFileSize, parseGalleryGenerationParams } from '@renderer/utils/gallery'
import PageShell from '@renderer/components/common/PageShell.vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import ActionableEmptyState from '@renderer/components/common/ActionableEmptyState.vue'
import GalleryFilterBar from '@renderer/components/gallery/GalleryFilterBar.vue'
import GalleryImageCard from '@renderer/components/gallery/GalleryImageCard.vue'

const { t, locale } = useI18n()
const message = useMessage()
const router = useRouter()
const route = useRoute()
const galleryStore = useGalleryStore()
const queueStore = useQueueStore()

// Filters
const searchText = ref('')
const filterJobId = ref(typeof route.query.jobId === 'string' ? route.query.jobId : undefined)
const filterRating = ref<number | null>(null)
const filterFavorite = ref<boolean | null>(null)
const sortBy = ref<'created_at' | 'rating' | 'file_size'>('created_at')
const sortOrder = ref<'asc' | 'desc'>('desc')

// Detail modal
const showDetail = ref(false)
const detailIndex = ref(-1)
const navigatingDetail = ref(false)
const transitionImage = ref<GalleryImage | null>(null)

const detailImage = computed<GalleryImage | null>(() => {
  if (navigatingDetail.value && transitionImage.value) return transitionImage.value
  if (detailIndex.value < 0 || detailIndex.value >= galleryStore.images.length) return null
  return galleryStore.images[detailIndex.value]
})

const canGoPrev = computed(
  () =>
    !galleryStore.loading &&
    !navigatingDetail.value &&
    (detailIndex.value > 0 || galleryStore.page > 1)
)
const canGoNext = computed(
  () =>
    !galleryStore.loading &&
    !navigatingDetail.value &&
    (galleryStore.page - 1) * galleryStore.pageSize + detailIndex.value + 1 < galleryStore.total
)
const positionLabel = computed(() => {
  if (!detailImage.value) return ''
  const globalIndex = (galleryStore.page - 1) * galleryStore.pageSize + detailIndex.value + 1
  return `${globalIndex} / ${galleryStore.total}`
})

// Selection mode
const selectionMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const failedImageIds = ref<Set<string>>(new Set())
const failedImageCount = computed(() => failedImageIds.value.size)

function toFileUrl(path: string | undefined): string {
  if (!path) return ''
  return 'local-asset://image/' + encodeURIComponent(path)
}

const sortOptions = computed(() => buildGallerySortOptions(t))

const ratingOptions = computed<SelectMixedOption[]>(() =>
  buildGalleryRatingOptions(t).map((option) => ({
    ...option,
    value: option.value === null ? (null as unknown as string) : option.value
  }))
)

const totalPages = computed(() => Math.ceil(galleryStore.total / galleryStore.pageSize))
const hasActiveFilters = computed(
  () => !!(searchText.value || filterRating.value || filterFavorite.value || filterJobId.value)
)
const formattedTotal = computed(() =>
  new Intl.NumberFormat(locale.value === 'ko' ? 'ko-KR' : 'en-US').format(galleryStore.total)
)

function goToJobs(): void {
  void router.push({ name: 'jobs' })
}

// Apply filters
async function applyFilters(): Promise<void> {
  showDetail.value = false
  selectedIds.value = new Set()
  failedImageIds.value = new Set()
  galleryStore.setFilters({
    jobId: filterJobId.value,
    searchText: searchText.value || undefined,
    minRating: filterRating.value || undefined,
    isFavorite: filterFavorite.value || undefined,
    sortBy: sortBy.value,
    sortOrder: sortOrder.value
  })
  try {
    await galleryStore.loadImages()
  } catch {
    message.error(t('gallery.msg.loadFailed'))
  }
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const SEARCH_DEBOUNCE_MS = 300

function handleSearchInput(): void {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => applyFilters(), SEARCH_DEBOUNCE_MS)
}

function handleSortChange(val: string): void {
  const [field, order] = val.split(':')
  sortBy.value = field as 'created_at' | 'rating' | 'file_size'
  sortOrder.value = order as 'asc' | 'desc'
  applyFilters()
}

function clearFilters(): void {
  filterJobId.value = undefined
  void router.replace({ query: { ...route.query, jobId: undefined } })
  searchText.value = ''
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

async function navigateDetail(direction: -1 | 1): Promise<void> {
  if (direction === -1 ? !canGoPrev.value : !canGoNext.value) return
  const nextIndex = detailIndex.value + direction
  if (nextIndex >= 0 && nextIndex < galleryStore.images.length) {
    detailIndex.value = nextIndex
    return
  }
  const targetPage = galleryStore.page + direction
  transitionImage.value = detailImage.value
  navigatingDetail.value = true
  try {
    await galleryStore.loadImages(targetPage)
    if (showDetail.value && galleryStore.page === targetPage) {
      detailIndex.value = direction === 1 ? 0 : galleryStore.images.length - 1
    }
  } catch {
    message.error(t('gallery.msg.loadFailed'))
  } finally {
    navigatingDetail.value = false
    transitionImage.value = null
  }
}

function goToPrev(): void {
  void navigateDetail(-1)
}

function goToNext(): void {
  void navigateDetail(1)
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

function markThumbnailFailed(id: string): void {
  failedImageIds.value.add(id)
  failedImageIds.value = new Set(failedImageIds.value)
}

function markThumbnailLoaded(id: string): void {
  if (!failedImageIds.value.delete(id)) return
  failedImageIds.value = new Set(failedImageIds.value)
}

function selectFailedImages(): void {
  selectionMode.value = true
  selectedIds.value = new Set(failedImageIds.value)
}

async function deleteSelected(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  await galleryStore.deleteImages(ids)
  for (const id of ids) failedImageIds.value.delete(id)
  failedImageIds.value = new Set(failedImageIds.value)
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
  const previousPage = galleryStore.page

  await galleryStore.deleteImages([id])
  message.success(t('gallery.msg.imageDeleted'))

  if (galleryStore.images.length === 0) {
    showDetail.value = false
    detailIndex.value = -1
  } else {
    detailIndex.value =
      previousPage === galleryStore.page
        ? Math.min(detailIndex.value, galleryStore.images.length - 1)
        : galleryStore.images.length - 1
  }
}

// Keyboard navigation for detail modal
function handleKeydown(e: KeyboardEvent): void {
  if (
    !showDetail.value ||
    (e.target instanceof HTMLElement &&
      (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)))
  )
    return

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

async function handlePageChange(p: number): Promise<void> {
  failedImageIds.value = new Set()
  try {
    await galleryStore.loadImages(p)
  } catch {
    message.error(t('gallery.msg.loadFailed'))
  }
}

watch(filterFavorite, () => applyFilters())
watch(
  () => route.query.jobId,
  (value) => {
    const jobId = typeof value === 'string' ? value : undefined
    if (filterJobId.value === jobId) return
    filterJobId.value = jobId
    void applyFilters()
  }
)

watch(
  () => galleryStore.images.map((image) => image.id),
  (visibleIds) => {
    const visible = new Set(visibleIds)
    const nextFailed = new Set([...failedImageIds.value].filter((id) => visible.has(id)))
    if (nextFailed.size !== failedImageIds.value.size) failedImageIds.value = nextFailed
  }
)

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
  () => queueStore.activeJobs.reduce((sum, j) => sum + j.completed_tasks, 0),
  () => {
    if (galleryRefreshTimer) clearTimeout(galleryRefreshTimer)
    galleryRefreshTimer = setTimeout(() => {
      if (!showDetail.value)
        void galleryStore.loadImages().catch(() => message.error(t('gallery.msg.loadFailed')))
    }, GALLERY_BATCH_REFRESH_DEBOUNCE_MS)
  }
)

onMounted(async () => {
  await applyFilters()

  const requestedImageId = typeof route.query.imageId === 'string' ? route.query.imageId : undefined
  if (!requestedImageId) return

  let requestedImage = galleryStore.images.find((image) => image.id === requestedImageId)
  if (!requestedImage && typeof route.query.fileName === 'string') {
    searchText.value = route.query.fileName
    await applyFilters()
    requestedImage = galleryStore.images.find((image) => image.id === requestedImageId)
  }

  if (requestedImage) openDetail(requestedImage)
})

onUnmounted(() => {
  if (galleryRefreshTimer) clearTimeout(galleryRefreshTimer)
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <PageShell class="gallery-view">
    <PageHeader :title="t('gallery.title')" :description="t('gallery.pageDescription')">
      <template v-if="galleryStore.total > 0" #meta>
        <NTag size="small" round>
          {{ t('gallery.imageCount', { count: formattedTotal }) }}
        </NTag>
      </template>
    </PageHeader>

    <NAlert v-if="filterJobId" type="info" :bordered="false" class="gallery-job-context">
      <div class="gallery-missing-alert__content">
        <span>{{ t('gallery.jobFilterActive') }}</span>
        <NButton size="small" secondary @click="clearFilters">{{
          t('gallery.showAllJobs')
        }}</NButton>
      </div>
    </NAlert>

    <GalleryFilterBar
      v-model:search-text="searchText"
      v-model:rating="filterRating"
      v-model:favorite="filterFavorite"
      :sort-value="`${sortBy}:${sortOrder}`"
      :sort-options="sortOptions"
      :rating-options="ratingOptions"
      :selection-mode="selectionMode"
      :selected-count="selectedIds.size"
      :has-active-filters="hasActiveFilters"
      @update:sort-value="handleSortChange"
      @search="handleSearchInput"
      @apply="applyFilters"
      @reset="clearFilters"
      @toggle-selection="toggleSelectionMode"
      @select-all="selectAll"
      @delete-selected="deleteSelected"
    />

    <NAlert
      v-if="failedImageCount > 0"
      class="gallery-missing-alert"
      type="warning"
      :title="t('gallery.missingOnPage', { count: failedImageCount })"
      :bordered="false"
    >
      <div class="gallery-missing-alert__content">
        <span>{{ t('gallery.missingOnPageHint') }}</span>
        <NButton size="small" type="warning" secondary @click="selectFailedImages">
          {{ t('gallery.selectMissing') }}
        </NButton>
      </div>
    </NAlert>

    <!-- Image grid -->
    <NCard style="margin-top: 0">
      <NGrid
        v-if="galleryStore.loading && galleryStore.images.length === 0"
        :cols="5"
        :x-gap="12"
        :y-gap="12"
        responsive="screen"
        :cols-s="2"
        :cols-m="3"
        :cols-l="4"
        :cols-xl="5"
      >
        <NGridItem v-for="index in 10" :key="index">
          <NCard size="small">
            <NSkeleton height="180px" />
            <NSkeleton text style="margin-top: 12px" />
          </NCard>
        </NGridItem>
      </NGrid>
      <template v-else-if="galleryStore.images.length > 0">
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
            <GalleryImageCard
              :image="image"
              :selected="selectedIds.has(image.id)"
              :selection-mode="selectionMode"
              :source="toFileUrl(image.thumbnail_path || image.file_path)"
              @open="openDetail(image)"
              @rate="(value) => galleryStore.rateImage(image.id, value)"
              @favorite="handleToggleFavorite(image)"
              @thumbnail-failed="markThumbnailFailed(image.id)"
              @thumbnail-loaded="markThumbnailLoaded(image.id)"
            />
          </NGridItem>
        </NGrid>

        <NDivider />
        <NSpace justify="center">
          <NPagination
            :page="galleryStore.page"
            :page-count="totalPages"
            :page-size="galleryStore.pageSize"
            :disabled="galleryStore.loading"
            @update:page="handlePageChange"
          />
        </NSpace>
      </template>
      <ActionableEmptyState
        v-else-if="hasActiveFilters"
        :title="t('gallery.noFilterResults')"
        :description="t('gallery.noFilterResultsDescription')"
        :action-label="t('gallery.resetFilters')"
        @action="clearFilters"
      />
      <ActionableEmptyState
        v-else
        :title="t('gallery.empty')"
        :description="t('gallery.emptyHint')"
        :action-label="t('gallery.goToJobs')"
        @action="goToJobs"
      />
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
                    @click="handleToggleFavorite(detailImage!)"
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
                {{ formatGalleryFileSize(detailImage.file_size) }}
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
                  @update:value="(val: number) => galleryStore.rateImage(detailImage!.id, val)"
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
                    v-if="parseGalleryGenerationParams(detailImage.generation_params)"
                    class="prompt-block"
                  >
                    <div class="prompt-label">Parameters</div>
                    <div class="prompt-text params">
                      <template
                        v-for="(value, key) in parseGalleryGenerationParams(
                          detailImage.generation_params
                        )"
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
  </PageShell>
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

.gallery-missing-alert,
.gallery-job-context {
  margin-bottom: 16px;
}

.gallery-missing-alert__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

@media (max-width: 768px) {
  .gallery-missing-alert__content {
    align-items: flex-start;
    flex-direction: column;
  }

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
