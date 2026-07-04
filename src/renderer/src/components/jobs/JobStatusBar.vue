<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NProgress, NSpace, NTag } from 'naive-ui'
import ConfirmActionButton from '@renderer/components/common/ConfirmActionButton'

const props = defineProps<{
  job: Record<string, unknown>
  isPaused: boolean
  eta: string | null
}>()

defineEmits<{
  pause: []
  resume: []
  cancel: []
}>()

const { t } = useI18n()

function progress(): number {
  const total = (props.job.total_tasks as number) || 0
  const completed = (props.job.completed_tasks as number) || 0
  return total > 0 ? Math.round((completed / total) * 100) : 0
}
</script>

<template>
  <NCard size="small" style="margin-bottom: 16px; border-radius: 12px">
    <NSpace align="center" justify="space-between">
      <NSpace align="center" :size="12">
        <NTag :type="isPaused ? 'default' : 'warning'" size="small" round>
          {{ isPaused ? t('queue.statusPaused') : t('queue.statusRunning') }}
        </NTag>
        <strong>{{ job.name }}</strong>
        <span style="font-size: 13px; opacity: 0.6">
          {{ job.completed_tasks }}/{{ job.total_tasks }}
          <template v-if="eta"> · {{ t('jobs.remainingTime', { time: eta }) }}</template>
        </span>
      </NSpace>
      <NSpace :size="8">
        <NButton v-if="!isPaused" size="small" @click="$emit('pause')">
          {{ t('batch.actions.pause') }}
        </NButton>
        <NButton v-else size="small" type="primary" @click="$emit('resume')">
          {{ t('batch.actions.resume') }}
        </NButton>
        <ConfirmActionButton
          size="small"
          type="error"
          quaternary
          :label="t('batch.actions.cancel')"
          :confirm-text="t('batch.confirmCancel')"
          @confirm="$emit('cancel')"
        />
      </NSpace>
    </NSpace>
    <NProgress
      type="line"
      :percentage="progress()"
      :show-indicator="false"
      style="margin-top: 8px"
      status="info"
    />
  </NCard>
</template>
