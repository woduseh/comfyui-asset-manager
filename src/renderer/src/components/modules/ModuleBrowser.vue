<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NCard, NTag, NTooltip } from 'naive-ui'
import type { PromptModule } from '@renderer/stores/module.store'
import ActionableEmptyState from '@renderer/components/common/ActionableEmptyState.vue'
import OverflowActionMenu, {
  type OverflowAction
} from '@renderer/components/common/OverflowActionMenu.vue'

defineProps<{
  modules: PromptModule[]
  selectedModuleId: string | null
  compact: boolean
  actions: OverflowAction[]
}>()

defineEmits<{
  select: [id: string]
  action: [action: string, module: PromptModule]
  create: []
}>()

const { t } = useI18n()
</script>

<template>
  <section class="module-browser" :class="{ 'module-browser--compact': compact }">
    <div v-if="modules.length > 0" class="module-grid">
      <NCard
        v-for="module in modules"
        :key="module.id"
        size="small"
        hoverable
        class="interactive-card module-card"
        :class="{ 'module-card--selected': selectedModuleId === module.id }"
        @click="$emit('select', module.id)"
      >
        <div class="module-card__header">
          <div class="module-card__copy">
            <NTooltip>
              <template #trigger>
                <div class="card-title module-card__title">{{ module.name }}</div>
              </template>
              {{ module.name }}
            </NTooltip>
            <NTooltip v-if="module.description">
              <template #trigger>
                <div class="card-description module-card__description">
                  {{ module.description }}
                </div>
              </template>
              {{ module.description }}
            </NTooltip>
          </div>
          <OverflowActionMenu
            :actions="actions"
            :menu-label="t('common.moreActions')"
            :confirm-positive-text="t('common.delete')"
            :confirm-negative-text="t('common.cancel')"
            @select="(action) => $emit('action', action, module)"
          />
        </div>
        <div class="module-card__footer">
          <NTag size="small" round>{{ t(`module.type.${module.type}`) }}</NTag>
        </div>
      </NCard>
    </div>
    <ActionableEmptyState
      v-else
      :title="t('module.empty')"
      :description="t('module.emptyDescription')"
      :action-label="t('module.create')"
      @action="$emit('create')"
    />
  </section>
</template>

<style scoped>
.module-browser {
  min-width: 0;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.module-browser--compact .module-grid {
  grid-template-columns: 1fr;
}

.module-card {
  min-width: 0;
  cursor: pointer;
  border-radius: var(--radius-md);
}

.module-card--selected {
  border-color: var(--n-color-target, #63e2b7);
  box-shadow: inset 3px 0 0 #63e2b7;
}

.module-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.module-card__copy {
  min-width: 0;
  flex: 1;
}

.module-card__title,
.module-card__description {
  max-width: 100%;
}

.module-card__description {
  margin-top: 4px;
  min-height: 34px;
}

.module-browser--compact .module-card__description {
  min-height: 0;
  -webkit-line-clamp: 1;
}

.module-card__footer {
  display: flex;
  margin-top: 10px;
}
</style>
