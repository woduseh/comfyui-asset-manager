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
  const page = ref(1)
  const pageSize = ref(DEFAULT_GALLERY_PAGE_SIZE)

  const filters = ref<Partial<GalleryQuery>>({
    sortBy: 'created_at',
    sortOrder: 'desc'
  })

  let pendingQuery: GalleryQuery | null = null
  let loadPromise: Promise<void> | null = null

  async function drainImageRequests(): Promise<void> {
    try {
      while (pendingQuery) {
        const query = pendingQuery
        pendingQuery = null
        try {
          const result = await invokeIpc(IPC_CHANNELS.GALLERY_LIST, query)
          // A newer request supersedes this result, including refreshes of the same page.
          if (!pendingQuery && result) {
            images.value = result.items as GalleryImage[]
            total.value = result.total
            page.value = query.page ?? 1
          }
        } catch (error) {
          if (!pendingQuery) throw error
        }
      }
    } finally {
      loading.value = false
      loadPromise = null
    }
  }

  function loadImages(targetPage = page.value): Promise<void> {
    // Bound IPC work to one active query and the latest pending query.
    pendingQuery = { ...filters.value, page: targetPage, pageSize: pageSize.value }
    if (!loadPromise) {
      loading.value = true
      loadPromise = Promise.resolve().then(drainImageRequests)
    }
    return loadPromise
  }

  async function rateImage(id: string, rating: number): Promise<void> {
    await invokeIpc(IPC_CHANNELS.GALLERY_RATE, { id, rating })
    const img = images.value.find((i) => i.id === id)
    if (img) img.rating = rating
  }

  async function toggleFavorite(id: string): Promise<void> {
    const img = images.value.find((i) => i.id === id)
    if (!img) return
    const newFav = img.is_favorite ? false : true
    await invokeIpc(IPC_CHANNELS.GALLERY_FAVORITE, { id, favorite: newFav })
    img.is_favorite = newFav ? 1 : 0
  }

  async function deleteImages(ids: string[]): Promise<void> {
    await invokeIpc(IPC_CHANNELS.GALLERY_DELETE, { ids })
    images.value = images.value.filter((i) => !ids.includes(i.id))
    total.value = Math.max(0, total.value - ids.length)
    // Refill the page so continuous navigation does not skip images after deletion.
    await loadImages(Math.min(page.value, Math.max(1, Math.ceil(total.value / pageSize.value))))
  }

  function setPage(p: number): void {
    page.value = p
  }

  function setFilters(f: Partial<GalleryQuery>): void {
    filters.value = { ...filters.value, ...f }
    page.value = 1
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
    page,
    pageSize,
    filters,
    loadImages,
    rateImage,
    toggleFavorite,
    deleteImages,
    copyToClipboard,
    showInExplorer,
    setPage,
    setFilters
  }
})
