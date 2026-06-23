<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NIcon, NSkeleton } from 'naive-ui'
import { ImageOutline, RefreshOutline } from '@vicons/ionicons5'

const props = defineProps<{
  src: string
  alt: string
  errorText: string
  retryText: string
}>()

const loading = ref(true)
const failed = ref(false)
const retryKey = ref(0)

watch(
  () => props.src,
  () => reset()
)

function reset(): void {
  loading.value = true
  failed.value = false
}

function handleLoad(): void {
  loading.value = false
  failed.value = false
}

function handleError(): void {
  loading.value = false
  failed.value = true
}

function retry(): void {
  retryKey.value += 1
  reset()
}
</script>

<template>
  <div class="gallery-thumbnail">
    <NSkeleton v-if="loading" class="gallery-thumbnail__skeleton" />
    <div v-if="failed" class="gallery-thumbnail__error" role="status">
      <NIcon :component="ImageOutline" :size="28" />
      <span>{{ errorText }}</span>
      <NButton size="tiny" quaternary @click.stop="retry">
        <template #icon><NIcon :component="RefreshOutline" /></template>
        {{ retryText }}
      </NButton>
    </div>
    <img
      v-show="!failed"
      :key="retryKey"
      class="gallery-thumbnail__image"
      :class="{ 'gallery-thumbnail__image--loading': loading }"
      :src="src"
      :alt="alt"
      loading="lazy"
      @load="handleLoad"
      @error="handleError"
    />
  </div>
</template>

<style scoped>
.gallery-thumbnail {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 8px;
  background: var(--app-surface-muted);
}

.gallery-thumbnail__skeleton {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}

.gallery-thumbnail__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gallery-thumbnail__image--loading {
  opacity: 0;
}

.gallery-thumbnail__error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--app-text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
