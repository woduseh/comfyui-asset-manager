<script setup lang="ts">
import { NButton, NEmpty } from 'naive-ui'

defineProps<{
  title: string
  description?: string
  actionLabel?: string
}>()

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <NEmpty :description="title" class="actionable-empty-state">
    <template v-if="$slots.icon" #icon>
      <slot name="icon" />
    </template>
    <template v-if="description || actionLabel" #extra>
      <div class="actionable-empty-state__extra">
        <p v-if="description">{{ description }}</p>
        <NButton v-if="actionLabel" size="small" @click="emit('action')">
          {{ actionLabel }}
        </NButton>
      </div>
    </template>
  </NEmpty>
</template>

<style scoped>
.actionable-empty-state__extra {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 420px;
}

.actionable-empty-state__extra p {
  margin: 0;
  color: var(--app-text-muted);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
</style>
