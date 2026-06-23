<script setup lang="ts">
withDefaults(
  defineProps<{
    width?: 'standard' | 'compact'
  }>(),
  { width: 'standard' }
)
</script>

<template>
  <main class="page-shell" :class="`page-shell--${width}`">
    <slot />
  </main>
</template>

<style scoped>
.page-shell {
  width: 100%;
  margin: 0 auto;
}

.page-shell--standard {
  max-width: var(--page-max-width);
}

.page-shell--compact {
  max-width: var(--page-compact-max-width);
}
</style>
