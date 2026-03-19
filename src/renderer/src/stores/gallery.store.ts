import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GalleryQuery } from '@renderer/types/ipc'

export interface GalleryImage {
  id: string
  file_path: string
  thumbnail_path: string | null
  width: number | null
  height: number | null
  rating: number
  is_favorite: number
  character_name: string | null
  outfit_name: string | null
  emotion_name: string | null
  style_name: string | null
  created_at: string
}

export const useGalleryStore = defineStore('gallery', () => {
  const images = ref<GalleryImage[]>([])
  const total = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const pageSize = ref(50)

  const filters = ref<Partial<GalleryQuery>>({
    sortBy: 'created_at',
    sortOrder: 'desc'
  })

  async function loadImages(): Promise<void> {
    loading.value = true
    try {
      const query: GalleryQuery = {
        page: page.value,
        pageSize: pageSize.value,
        ...filters.value
      } as GalleryQuery

      const result = await window.electron.ipcRenderer.invoke('gallery:list', query)
      if (result) {
        images.value = result.items as GalleryImage[]
        total.value = result.total
      }
    } finally {
      loading.value = false
    }
  }

  async function rateImage(id: string, rating: number): Promise<void> {
    await window.electron.ipcRenderer.invoke('gallery:rate', { id, rating })
    const img = images.value.find((i) => i.id === id)
    if (img) img.rating = rating
  }

  async function toggleFavorite(id: string): Promise<void> {
    const img = images.value.find((i) => i.id === id)
    if (!img) return
    const newFav = img.is_favorite ? false : true
    await window.electron.ipcRenderer.invoke('gallery:favorite', { id, favorite: newFav })
    img.is_favorite = newFav ? 1 : 0
  }

  async function deleteImages(ids: string[]): Promise<void> {
    await window.electron.ipcRenderer.invoke('gallery:delete', { ids })
    images.value = images.value.filter((i) => !ids.includes(i.id))
    total.value -= ids.length
  }

  function setPage(p: number): void {
    page.value = p
  }

  function setFilters(f: Partial<GalleryQuery>): void {
    filters.value = { ...filters.value, ...f }
    page.value = 1
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
    setPage,
    setFilters
  }
})
