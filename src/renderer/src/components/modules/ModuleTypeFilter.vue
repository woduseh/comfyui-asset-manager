<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NSpace } from 'naive-ui'

defineProps<{ options: Array<{ label: string; value: string }> }>()
const filterType = defineModel<string | null>({ required: true })
const { t } = useI18n()
</script>

<template>
  <div style="margin: 12px 0">
    <NSpace :size="4" :wrap="true">
      <NButton
        size="small"
        :type="!filterType ? 'primary' : 'default'"
        :tertiary="!!filterType"
        round
        @click="filterType = null"
      >
        {{ t('module.selectAll') }}
      </NButton>
      <NButton
        v-for="option in options"
        :key="option.value"
        size="small"
        :type="filterType === option.value ? 'primary' : 'default'"
        :tertiary="filterType !== option.value"
        round
        @click="filterType = option.value"
      >
        {{ option.label }}
      </NButton>
    </NSpace>
  </div>
</template>
