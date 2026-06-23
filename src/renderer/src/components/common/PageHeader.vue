<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header class="page-header">
    <div class="page-header__copy">
      <div class="page-header__title-row">
        <h2>{{ title }}</h2>
        <slot name="meta" />
      </div>
      <p v-if="description" class="page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
}

.page-header__copy {
  min-width: 0;
}

.page-header__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
}

.page-header h2 {
  margin: 0;
}

.page-header__description {
  margin: 4px 0 0;
  color: var(--app-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.page-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
    gap: 12px;
  }

  .page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
