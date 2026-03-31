import { defineComponent, h } from 'vue'
import { NButton, NPopconfirm } from 'naive-ui'

export default defineComponent({
  name: 'ConfirmActionButton',
  inheritAttrs: false,
  props: {
    label: {
      type: String,
      required: true
    },
    confirmText: {
      type: String,
      required: true
    }
  },
  emits: ['confirm'],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        NPopconfirm,
        {
          onPositiveClick: () => emit('confirm')
        },
        {
          trigger: () =>
            h(NButton, attrs, {
              default: () => props.label
            }),
          default: () => props.confirmText
        }
      )
  }
})
