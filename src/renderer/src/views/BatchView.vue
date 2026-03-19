<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NCard, NEmpty } from 'naive-ui'

const { t } = useI18n()
</script>

<template>
  <div class="batch-view">
    <h2>{{ t('batch.title') }}</h2>
    <NCard style="margin-top: 16px;">
      <NEmpty :description="t('batch.empty')" />
    </NCard>
  </div>
</template>
