// @vitest-environment happy-dom

import { defineComponent, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import GalleryView from '@renderer/views/GalleryView.vue'
import GalleryFilterBar from '@renderer/components/gallery/GalleryFilterBar.vue'
import GalleryImageCard from '@renderer/components/gallery/GalleryImageCard.vue'
import { useGalleryStore } from '@renderer/stores/gallery.store'
import en from '@renderer/locales/en.json'

const { invokeIpc, replace, route } = vi.hoisted(() => ({
  invokeIpc: vi.fn(),
  replace: vi.fn(),
  route: { query: {} as Record<string, string> }
}))
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useRoute: () => route
}))

describe('gallery continuous viewer', () => {
  let wrapper: VueWrapper | undefined
  let rejectNavigation = false
  let pendingNavigation: (() => void) | undefined

  beforeEach(() => {
    route.query = reactive({ jobId: 'selected-job' })
    rejectNavigation = false
    pendingNavigation = undefined
    invokeIpc.mockReset()
    invokeIpc.mockImplementation(async (channel, query) => {
      if (channel !== IPC_CHANNELS.GALLERY_LIST) return true
      if (query.page === 2 && rejectNavigation) throw new Error('offline')
      if (query.page === 2 && pendingNavigation)
        await new Promise<void>((resolve) => {
          pendingNavigation = resolve
        })
      const first = (query.page - 1) * 2 + 1
      return {
        items: [first, first + 1]
          .filter((id) => id <= 3)
          .map((id) => ({
            id: String(id),
            file_path: `image-${id}.png`,
            rating: 0,
            is_favorite: 0
          })),
        total: 3
      }
    })
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  async function openGallery(): Promise<VueWrapper> {
    const pinia = createPinia()
    useGalleryStore(pinia).pageSize = 2
    wrapper = mount(
      defineComponent({
        components: { GalleryView, NMessageProvider },
        template: '<NMessageProvider><GalleryView /></NMessageProvider>'
      }),
      {
        global: {
          plugins: [
            pinia,
            createI18n({
              legacy: false,
              locale: 'en',
              messages: { en },
              missingWarn: false,
              fallbackWarn: false
            })
          ],
          stubs: {
            teleport: true,
            NImage: true,
            GalleryImageCard: true
          }
        }
      }
    )
    await flushPromises()
    return wrapper
  }

  it('navigates across pages in both directions with the job filter preserved', async () => {
    const view = await openGallery()
    view.findAllComponents(GalleryImageCard)[1].vm.$emit('open')
    await flushPromises()
    expect(view.get('.detail-position').text()).toBe('2 / 3')
    await view.get('.nav-next').trigger('click')
    await flushPromises()
    expect(view.get('.detail-position').text()).toBe('3 / 3')
    expect(view.get('.nav-next').attributes('disabled')).toBeDefined()
    expect(invokeIpc.mock.calls.at(-1)?.[1]).toMatchObject({ page: 2, jobId: 'selected-job' })
    await view.get('.nav-prev').trigger('click')
    await flushPromises()
    expect(view.get('.detail-position').text()).toBe('2 / 3')
  })

  it('keeps the current image on failure and allows retry', async () => {
    const view = await openGallery()
    view.findAllComponents(GalleryImageCard)[1].vm.$emit('open')
    await flushPromises()
    rejectNavigation = true
    await view.get('.nav-next').trigger('click')
    await flushPromises()
    expect(view.get('.detail-position').text()).toBe('2 / 3')
    rejectNavigation = false
    await view.get('.nav-next').trigger('click')
    await flushPromises()
    expect(view.get('.detail-position').text()).toBe('3 / 3')
  })

  it('blocks repeated navigation while a page is loading', async () => {
    const view = await openGallery()
    view.findAllComponents(GalleryImageCard)[1].vm.$emit('open')
    await flushPromises()
    pendingNavigation = () => {}
    await view.get('.nav-next').trigger('click')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(invokeIpc.mock.calls.filter(([, query]) => query.page === 2)).toHaveLength(1)
    pendingNavigation!()
    await flushPromises()
    expect(view.get('.detail-position').text()).toBe('3 / 3')
  })

  it('selects only visible images and clears the selection when filters change', async () => {
    const view = await openGallery()
    const bar = view.findComponent(GalleryFilterBar)
    bar.vm.$emit('toggleSelection')
    bar.vm.$emit('selectAll')
    await flushPromises()
    expect(bar.props('selectedCount')).toBe(2)
    bar.vm.$emit('reset')
    await flushPromises()
    expect(bar.props('selectedCount')).toBe(0)
    expect(invokeIpc.mock.calls.at(-1)?.[1].jobId).toBeUndefined()
  })
})
