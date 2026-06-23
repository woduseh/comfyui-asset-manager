// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GalleryThumbnail from '../../src/renderer/src/components/gallery/GalleryThumbnail.vue'

function mountThumbnail(): ReturnType<typeof mount> {
  return mount(GalleryThumbnail, {
    props: {
      src: 'local-asset://image/test.png',
      alt: 'Test image',
      errorText: 'Could not load image',
      retryText: 'Retry'
    }
  })
}

describe('GalleryThumbnail', () => {
  it('shows the image after loading', async () => {
    const wrapper = mountThumbnail()
    const image = wrapper.get('img')

    expect(image.classes()).toContain('gallery-thumbnail__image--loading')
    await image.trigger('load')
    expect(image.classes()).not.toContain('gallery-thumbnail__image--loading')
  })

  it('shows an error state and resets when retrying', async () => {
    const wrapper = mountThumbnail()
    await wrapper.get('img').trigger('error')

    expect(wrapper.text()).toContain('Could not load image')
    await wrapper.get('button').trigger('click')

    expect(wrapper.text()).not.toContain('Could not load image')
    expect(wrapper.get('img').classes()).toContain('gallery-thumbnail__image--loading')
  })
})
