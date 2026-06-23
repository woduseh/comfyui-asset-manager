// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { NButton, NPopconfirm } from 'naive-ui'
import OverflowActionMenu from '../../src/renderer/src/components/common/OverflowActionMenu.vue'

function mountMenu(): ReturnType<typeof mount> {
  return mount(OverflowActionMenu, {
    props: {
      menuLabel: 'More actions',
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'disabled', label: 'Disabled', disabled: true },
        { key: 'delete', label: 'Delete', danger: true, confirmText: 'Delete this?' }
      ]
    },
    attachTo: document.body
  })
}

describe('OverflowActionMenu', () => {
  it('renders an accessible trigger and disabled actions', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.findComponent(NButton)

    expect(trigger.attributes('aria-label')).toBe('More actions')
    await trigger.trigger('click')
    expect(document.body.textContent).toContain('Disabled')
    expect(document.body.querySelector('button[disabled]')).not.toBeNull()

    wrapper.unmount()
  })

  it('emits regular actions immediately', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.findComponent(NButton)
    await trigger.trigger('click')

    const editButton = wrapper.findAllComponents(NButton).find((button) => button.text() === 'Edit')
    await editButton!.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['edit']])
    wrapper.unmount()
  })

  it('emits destructive actions only after confirmation', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.findComponent(NButton)
    await trigger.trigger('click')

    wrapper.findComponent(NPopconfirm).vm.$emit('positive-click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('select')).toEqual([['delete']])
    wrapper.unmount()
  })
})
