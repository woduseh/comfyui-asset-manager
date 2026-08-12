// @vitest-environment happy-dom

import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecentResultsPanel from '@renderer/components/jobs/RecentResultsPanel.vue'

const pushMock = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock })
}))

function createTestI18n(): ReturnType<typeof createI18n> {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: {} }
  })
}

const images = [
  {
    id: 'image-1',
    file_path: 'C:\\output\\first.png',
    thumbnail_path: null,
    width: 512,
    height: 768,
    file_size: 1024,
    rating: 0,
    is_favorite: 0,
    character_name: 'First',
    outfit_name: null,
    emotion_name: null,
    style_name: null,
    prompt_text: null,
    negative_text: null,
    generation_params: null,
    created_at: '2026-08-12 10:00:00'
  },
  {
    id: 'image-2',
    file_path: 'C:\\output\\second.png',
    thumbnail_path: null,
    width: 512,
    height: 768,
    file_size: 2048,
    rating: 0,
    is_favorite: 0,
    character_name: 'Second',
    outfit_name: null,
    emotion_name: null,
    style_name: null,
    prompt_text: null,
    negative_text: null,
    generation_params: null,
    created_at: '2026-08-12 10:01:00'
  }
]

beforeEach(() => pushMock.mockReset())

describe('RecentResultsPanel', () => {
  it('opens the selected image in the gallery detail route', async () => {
    const wrapper = mount(RecentResultsPanel, {
      props: { images, loading: false, loadError: false },
      global: { plugins: [createTestI18n()] }
    })

    await wrapper.findAll('.results-panel__thumb')[1].trigger('click')
    const openButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('openResult'))
    await openButton!.trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith({
      name: 'gallery',
      query: { imageId: 'image-2', fileName: 'second.png' }
    })
  })

  it('shows a retry action when the isolated recent-results query fails', async () => {
    const wrapper = mount(RecentResultsPanel, {
      props: { images: [], loading: false, loadError: true },
      global: { plugins: [createTestI18n()] }
    })

    await wrapper.get('.results-panel__empty button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('retries unavailable thumbnails when a fresh result query arrives', async () => {
    const wrapper = mount(RecentResultsPanel, {
      props: { images: [images[0]], loading: false, loadError: false },
      global: { plugins: [createTestI18n()] }
    })

    await wrapper.get('.results-panel__thumb img').trigger('error')
    expect(wrapper.findAll('.results-panel__thumb')).toHaveLength(0)
    expect(wrapper.find('.results-panel__empty button').exists()).toBe(true)

    await wrapper.setProps({ images: [{ ...images[0] }] })
    expect(wrapper.findAll('.results-panel__thumb')).toHaveLength(1)
  })
})
