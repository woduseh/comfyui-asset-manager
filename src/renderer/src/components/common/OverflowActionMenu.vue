<script setup lang="ts">
import { ref, type Component } from 'vue'
import { NButton, NIcon, NPopover, NPopconfirm } from 'naive-ui'
import { EllipsisHorizontal } from '@vicons/ionicons5'

export interface OverflowAction {
  key: string
  label: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
  confirmText?: string
}

withDefaults(
  defineProps<{
    actions: OverflowAction[]
    menuLabel: string
    confirmPositiveText?: string
    confirmNegativeText?: string
  }>(),
  {
    confirmPositiveText: undefined,
    confirmNegativeText: undefined
  }
)

const emit = defineEmits<{
  select: [key: string]
}>()

const show = ref(false)

function selectAction(key: string): void {
  show.value = false
  emit('select', key)
}
</script>

<template>
  <NPopover v-model:show="show" trigger="click" placement="bottom-end" :show-arrow="false">
    <template #trigger>
      <NButton quaternary circle size="tiny" :aria-label="menuLabel" :title="menuLabel" @click.stop>
        <template #icon><NIcon :component="EllipsisHorizontal" /></template>
      </NButton>
    </template>

    <div class="overflow-menu" role="menu">
      <template v-for="action in actions" :key="action.key">
        <NPopconfirm
          v-if="action.confirmText"
          :positive-text="confirmPositiveText"
          :negative-text="confirmNegativeText"
          @positive-click="selectAction(action.key)"
        >
          <template #trigger>
            <NButton
              text
              block
              :type="action.danger ? 'error' : 'default'"
              :disabled="action.disabled"
              role="menuitem"
              class="overflow-menu__item"
              @click.stop
            >
              <template v-if="action.icon" #icon><NIcon :component="action.icon" /></template>
              {{ action.label }}
            </NButton>
          </template>
          {{ action.confirmText }}
        </NPopconfirm>
        <NButton
          v-else
          text
          block
          :type="action.danger ? 'error' : 'default'"
          :disabled="action.disabled"
          role="menuitem"
          class="overflow-menu__item"
          @click.stop="selectAction(action.key)"
        >
          <template v-if="action.icon" #icon><NIcon :component="action.icon" /></template>
          {{ action.label }}
        </NButton>
      </template>
    </div>
  </NPopover>
</template>

<style scoped>
.overflow-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  padding: 2px;
}

.overflow-menu__item {
  justify-content: flex-start;
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
}
</style>
