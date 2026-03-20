<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NEmpty, NGrid, NGridItem, NImage, NSpace, NRate, NButton,
  NTag, NSelect, NPagination, NModal, NDescriptions, NDescriptionsItem,
  NCheckbox, NDivider, NPopconfirm, useMessage
} from 'naive-ui'
import type { SelectMixedOption } from 'naive-ui/es/select/src/interface'
import { useGalleryStore, type GalleryImage } from '@renderer/stores/gallery.store'

const { t } = useI18n()
const message = useMessage()
const galleryStore = useGalleryStore()

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
const detailImage = ref<GalleryImage | null>(null)

// Selection mode
const selectionMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toFileUrl(path: string | undefined): string {
  if (!path) return ''
  return 'local-asset://image/' + encodeURIComponent(path)
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
  detailImage.value = image
  showDetail.value = true
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

function handlePageChange(p: number): void {
  galleryStore.setPage(p)
  galleryStore.loadImages()
}

watch(filterFavorite, () => applyFilters())

onMounted(() => {
  galleryStore.loadImages()
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
      preset="card"
      style="width: 800px; max-height: 85vh;"
      :title="detailImage?.character_name || '이미지 상세'"
      :bordered="false"
    >
      <template v-if="detailImage">
        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NImage
              :src="toFileUrl(detailImage.file_path)"
              :width="380"
              object-fit="contain"
              style="border-radius: 8px;"
            />
          </NGridItem>
          <NGridItem>
            <NDescriptions label-placement="left" :column="1" bordered size="small">
              <NDescriptionsItem label="캐릭터">{{ detailImage.character_name || '-' }}</NDescriptionsItem>
              <NDescriptionsItem label="복장">{{ detailImage.outfit_name || '-' }}</NDescriptionsItem>
              <NDescriptionsItem label="감정">{{ detailImage.emotion_name || '-' }}</NDescriptionsItem>
              <NDescriptionsItem label="스타일">{{ detailImage.style_name || '-' }}</NDescriptionsItem>
              <NDescriptionsItem label="평점">
                <NRate
                  :value="detailImage.rating"
                  :count="5"
                  @update:value="(val: number) => { galleryStore.rateImage(detailImage!.id, val); detailImage!.rating = val }"
                />
              </NDescriptionsItem>
              <NDescriptionsItem label="즐겨찾기">
                <NButton
                  text
                  :type="detailImage.is_favorite ? 'warning' : 'default'"
                  @click="() => { handleToggleFavorite(detailImage!); detailImage!.is_favorite = detailImage!.is_favorite ? 0 : 1 }"
                >
                  {{ detailImage.is_favorite ? '♥ 즐겨찾기' : '♡ 즐겨찾기 추가' }}
                </NButton>
              </NDescriptionsItem>
              <NDescriptionsItem label="파일">
                <span style="font-size: 11px; word-break: break-all;">{{ detailImage.file_path }}</span>
              </NDescriptionsItem>
              <NDescriptionsItem label="생성일">{{ detailImage.created_at }}</NDescriptionsItem>
            </NDescriptions>
          </NGridItem>
        </NGrid>
      </template>
    </NModal>
  </div>
</template>
