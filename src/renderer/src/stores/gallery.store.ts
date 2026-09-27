import { createLatestRequest } from '@renderer/utils/latest-request'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GalleryQuery } from '@shared/ipc-contract'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { DEFAULT_GALLERY_PAGE_SIZE } from '@renderer/constants'

export interface GalleryImage {
  id: string
  job_id?: string | null
  file_path: string
  thumbnail_path: string | null
  width: number | null
  height: number | null
  file_size: number | null
  rating: number
  is_favorite: number
  character_name: string | null
  outfit_name: string | null
  emotion_name: string | null
  style_name: string | null
  prompt_text: string | null
  negative_text: string | null
  generation_params: string | null
  created_at: string
}

export const useGalleryStore = defineStore('gallery', () => {
  const images = ref<GalleryImage[]>([])
  const total = ref(0)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  let targetPage = 1
  const page = ref(1)
  const pageSize = ref(DEFAULT_GALLERY_PAGE_SIZE)

  const filters = ref<Partial<GalleryQuery>>({
    sortBy: 'created_at',
    sortOrder: 'desc'
  })

  const requests = createLatestRequest({
    read: (query: GalleryQuery) => invokeIpc(IPC_CHANNELS.GALLERY_LIST, query),
    commit: (result, query) => {
      images.value = result.items
      total.value = result.total
      page.value = query.page ?? 1
      loadError.value = null
    },
    loading: (value) => {
      loading.value = value
    },
    error: (error) => {
      loadError.value = error instanceof Error ? error.message : String(error)
    }
  })

  function loadImages(requestedPage = targetPage): Promise<void> {
    targetPage = requestedPage
    return requests.request({ ...filters.value, page: targetPage, pageSize: pageSize.value })
  }

  async function rateImage(id: string, rating: number): Promise<void> {
    await invokeIpc(IPC_CHANNELS.GALLERY_RATE, { id, rating })
    const img = images.value.find((i) => i.id === id)
    if (img) img.rating = rating
    requests.refreshIfRunning()
  }

  async function toggleFavorite(id: string): Promise<void> {
    const img = images.value.find((i) => i.id === id)
    if (!img) return
    const newFav = img.is_favorite ? false : true
    await invokeIpc(IPC_CHANNELS.GALLERY_FAVORITE, { id, favorite: newFav })
    const current = images.value.find((image) => image.id === id)
    if (current) current.is_favorite = newFav ? 1 : 0
    requests.refreshIfRunning()
  }

  async function deleteImages(ids: string[]): Promise<void> {
    await invokeIpc(IPC_CHANNELS.GALLERY_DELETE, { ids })
    images.value = images.value.filter((i) => !ids.includes(i.id))
    total.value = Math.max(0, total.value - ids.length)
    // Refill the page so continuous navigation does not skip images after deletion.
    await loadImages(Math.min(page.value, Math.max(1, Math.ceil(total.value / pageSize.value))))
  }

  function setFilters(f: Partial<GalleryQuery>): void {
    filters.value = { ...filters.value, ...f }
    targetPage = 1
    requests.cancel()
  }

  async function copyToClipboard(filePath: string): Promise<boolean> {
    const result = await invokeIpc(IPC_CHANNELS.GALLERY_COPY_CLIPBOARD, { filePath })
    return result?.success === true
  }

  async function showInExplorer(filePath: string): Promise<void> {
    await invokeIpc(IPC_CHANNELS.GALLERY_SHOW_IN_EXPLORER, { filePath })
  }

  return {
    images,
    total,
    loading,
    loadError,
    page,
    pageSize,
    filters,
    loadImages,
    rateImage,
    toggleFavorite,
    deleteImages,
    copyToClipboard,
    showInExplorer,
    setFilters
  }
})
