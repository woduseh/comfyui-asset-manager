// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { NPopconfirm } from 'naive-ui'
import ConfirmActionButton from '../../src/renderer/src/components/common/ConfirmActionButton'

describe('ConfirmActionButton', () => {
  it('emits confirm when the popconfirm is accepted', async () => {
    const wrapper = mount(ConfirmActionButton, {
      props: {
        label: 'Delete',
        confirmText: 'Delete this item?'
      }
    })

    wrapper.findComponent(NPopconfirm).vm.$emit('positive-click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })
})
