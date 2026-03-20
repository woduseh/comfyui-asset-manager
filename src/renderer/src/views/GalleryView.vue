<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NEmpty, NGrid, NGridItem, NImage, NSpace, NRate, NButton,
  NTag, NSelect, NPagination, NModal,
  NCheckbox, NDivider, NPopconfirm, useMessage, NTooltip, NCollapse,
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
  { label: '생성일 (최신)', value: 'created_at:desc' },
  { label: '생성일 (오래된)', value: 'created_at:asc' },
  { label: '평점 (높은순)', value: 'rating:desc' },
  { label: '평점 (낮은순)', value: 'rating:asc' }
]

const ratingOptions: SelectMixedOption[] = [
  { label: '전체', value: null as unknown as string },
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
  message.success(`${ids.length}장 삭제됨`)
}

async function handleToggleFavorite(image: GalleryImage): Promise<void> {
  await galleryStore.toggleFavorite(image.id)
}

async function handleCopyToClipboard(): Promise<void> {
  if (!detailImage.value) return
  const success = await galleryStore.copyToClipboard(detailImage.value.file_path)
  if (success) {
    message.success('클립보드에 복사됨')
  } else {
    message.error('복사 실패')
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
  message.success('이미지 삭제됨')

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
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">
        {{ t('gallery.title') }}
        <NTag v-if="galleryStore.total > 0" size="small" round style="margin-left: 8px;">{{ galleryStore.total }}</NTag>
      </h2>
    </div>

    <!-- Filter bar -->
    <NCard size="small" style="margin-bottom: 16px;">
      <NSpace align="center" :wrap="false" :size="12">
        <NSelect
          :value="sortBy + ':' + sortOrder"
          :options="sortOptions"
          size="small"
          style="width: 160px;"
          @update:value="handleSortChange"
        />
        <NSelect
          v-model:value="filterRating"
          :options="ratingOptions"
          size="small"
          style="width: 120px;"
          placeholder="평점"
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
          {{ filterFavorite ? '♥ 즐겨찾기' : '♡ 즐겨찾기' }}
        </NButton>
        <NButton size="small" quaternary @click="clearFilters" v-if="filterRating || filterFavorite">
          필터 초기화
        </NButton>
        <div style="flex: 1;" />
        <NButton
          size="small"
          :type="selectionMode ? 'primary' : 'default'"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? '선택 해제' : '선택 모드' }}
        </NButton>
        <template v-if="selectionMode">
          <NButton size="small" @click="selectAll">전체 선택</NButton>
          <NPopconfirm @positive-click="deleteSelected">
            <template #trigger>
              <NButton size="small" type="error" :disabled="selectedIds.size === 0">
                삭제 ({{ selectedIds.size }})
              </NButton>
            </template>
            선택한 {{ selectedIds.size }}장을 삭제하시겠습니까?
          </NPopconfirm>
        </template>
      </NSpace>
    </NCard>

    <!-- Image grid -->
    <NCard style="margin-top: 0;">
      <template v-if="galleryStore.images.length > 0">
        <NGrid :cols="5" :x-gap="12" :y-gap="12" responsive="screen" :cols-s="2" :cols-m="3" :cols-l="4" :cols-xl="5">
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
                style="aspect-ratio: 1; border-radius: 8px; width: 100%;"
                preview-disabled
              />
              <NSpace justify="space-between" align="center" style="margin-top: 8px;">
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
              <div v-if="image.character_name" style="margin-top: 4px; font-size: 11px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {{ [image.character_name, image.outfit_name, image.emotion_name].filter(Boolean).join(' / ') }}
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
      style="padding: 0;"
      transform-origin="center"
    >
      <div class="detail-overlay" v-if="detailImage" @click.self="showDetail = false">
        <!-- Navigation: Previous -->
        <button
          class="nav-btn nav-prev"
          :disabled="!canGoPrev"
          @click="goToPrev"
          title="이전 이미지 (←)"
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
                클립보드에 복사 (Ctrl+C)
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="small" @click="handleShowInExplorer">
                    📂
                  </NButton>
                </template>
                파일 탐색기에서 열기
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton
                    quaternary circle size="small"
                    :type="detailImage.is_favorite ? 'warning' : 'default'"
                    @click="() => { handleToggleFavorite(detailImage!); detailImage!.is_favorite = detailImage!.is_favorite ? 0 : 1 }"
                  >
                    {{ detailImage.is_favorite ? '♥' : '♡' }}
                  </NButton>
                </template>
                {{ detailImage.is_favorite ? '즐겨찾기 해제' : '즐겨찾기 추가' }}
              </NTooltip>
              <NPopconfirm @positive-click="handleDeleteFromDetail" positive-text="삭제" negative-text="취소">
                <template #trigger>
                  <NTooltip>
                    <template #trigger>
                      <NButton quaternary circle size="small" type="error">
                        🗑️
                      </NButton>
                    </template>
                    이미지 삭제
                  </NTooltip>
                </template>
                이 이미지를 삭제하시겠습니까?
              </NPopconfirm>
              <NButton quaternary circle size="small" @click="showDetail = false" style="margin-left: 8px;">
                ✕
              </NButton>
            </div>
          </div>

          <!-- Image area -->
          <div class="detail-image-area">
            <NImage
              :src="toFileUrl(detailImage.file_path)"
              object-fit="contain"
              style="max-height: 65vh; max-width: 100%; border-radius: 8px;"
              :preview-disabled="false"
            />
          </div>

          <!-- Info panel -->
          <div class="detail-info-panel">
            <div class="detail-info-row">
              <NRate
                :value="detailImage.rating"
                :count="5"
                size="small"
                @update:value="(val: number) => { galleryStore.rateImage(detailImage!.id, val); detailImage!.rating = val }"
              />
              <span class="detail-meta-text detail-meta-right">
                {{ formatFileSize(detailImage.file_size) }}
                <template v-if="detailImage.width && detailImage.height">
                  · {{ detailImage.width }}×{{ detailImage.height }}
                </template>
                · {{ detailImage.created_at?.split('T')[0] || detailImage.created_at }}
              </span>
            </div>

            <!-- Metadata table -->
            <div class="detail-metadata" v-if="detailImage.character_name || detailImage.outfit_name || detailImage.emotion_name || detailImage.style_name">
              <div class="metadata-item" v-if="detailImage.character_name">
                <span class="metadata-label">캐릭터</span>
                <span class="metadata-value">{{ detailImage.character_name }}</span>
              </div>
              <div class="metadata-item" v-if="detailImage.outfit_name">
                <span class="metadata-label">복장</span>
                <span class="metadata-value">{{ detailImage.outfit_name }}</span>
              </div>
              <div class="metadata-item" v-if="detailImage.emotion_name">
                <span class="metadata-label">감정</span>
                <span class="metadata-value">{{ detailImage.emotion_name }}</span>
              </div>
              <div class="metadata-item" v-if="detailImage.style_name">
                <span class="metadata-label">스타일</span>
                <span class="metadata-value">{{ detailImage.style_name }}</span>
              </div>
            </div>

            <!-- File path -->
            <div class="detail-filepath">
              <span class="metadata-label">파일</span>
              <span class="filepath-text" :title="detailImage.file_path">{{ detailImage.file_path }}</span>
            </div>

            <!-- Prompt info (collapsible) -->
            <NCollapse v-if="detailImage.prompt_text || detailImage.negative_text || detailImage.generation_params" style="margin-top: 8px;">
              <NCollapseItem title="프롬프트 정보" name="prompt">
                <div v-if="detailImage.prompt_text" class="prompt-block">
                  <div class="prompt-label">Positive</div>
                  <div class="prompt-text">{{ detailImage.prompt_text }}</div>
                </div>
                <div v-if="detailImage.negative_text" class="prompt-block">
                  <div class="prompt-label">Negative</div>
                  <div class="prompt-text negative">{{ detailImage.negative_text }}</div>
                </div>
                <div v-if="parseGenerationParams(detailImage.generation_params)" class="prompt-block">
                  <div class="prompt-label">Parameters</div>
                  <div class="prompt-text params">
                    <template v-for="(value, key) in parseGenerationParams(detailImage.generation_params)" :key="key">
                      <NTag size="tiny" round style="margin: 2px;">{{ key }}: {{ value }}</NTag>
                    </template>
                  </div>
                </div>
              </NCollapseItem>
            </NCollapse>
          </div>
        </div>

        <!-- Navigation: Next -->
        <button
          class="nav-btn nav-next"
          :disabled="!canGoNext"
          @click="goToNext"
          title="다음 이미지 (→)"
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
  transition: background 0.2s, opacity 0.2s;
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
  max-width: 900px;
  width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
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
  padding: 16px;
  min-height: 300px;
}

.detail-info-panel {
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.detail-info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-meta-text {
  font-size: 12px;
  opacity: 0.7;
}
.detail-meta-right {
  margin-left: auto;
}

.detail-metadata {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px 16px;
  margin-top: 10px;
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
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
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
</style>
