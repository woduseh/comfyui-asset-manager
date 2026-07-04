<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CopyOutline, CreateOutline, TrashOutline } from '@vicons/ionicons5'
import { NButton, NCard, NProgress, NSpace, NTag } from 'naive-ui'
import OverflowActionMenu, {
  type OverflowAction
} from '@renderer/components/common/OverflowActionMenu.vue'
import { getJobStatusType } from '@renderer/utils/status-presentation'

const props = defineProps<{
  job: Record<string, unknown>
  statusLabel: string
  isConnected: boolean
  isProcessing: boolean
}>()

const emit = defineEmits<{
  start: []
  rerun: []
  edit: []
  clone: []
  delete: []
}>()

const { t } = useI18n()
const progress = computed(() => {
  const total = (props.job.total_tasks as number) || 0
  const completed = (props.job.completed_tasks as number) || 0
  return total > 0 ? Math.round((completed / total) * 100) : 0
})

const actions = computed<OverflowAction[]>(() => [
  { key: 'edit', label: t('batch.actions.edit'), icon: CreateOutline },
  { key: 'clone', label: t('batch.actions.clone'), icon: CopyOutline },
  {
    key: 'delete',
    label: t('batch.actions.delete'),
    icon: TrashOutline,
    danger: true,
    confirmText: t('batch.confirmDelete')
  }
])

function handleAction(action: string): void {
  if (action === 'edit') emit('edit')
  if (action === 'clone') emit('clone')
  if (action === 'delete') emit('delete')
}
</script>

<template>
  <NCard size="small" class="job-card">
    <div class="job-card__header">
      <div class="job-card__identity">
        <span class="job-drag-handle">⠿</span>
        <div class="job-card__copy">
          <div class="card-title job-card__title" :title="job.name as string">
            {{ job.name }}
          </div>
          <NSpace :size="6" style="margin-top: 4px">
            <NTag :type="getJobStatusType(job.status as string)" size="small" round>
              {{ statusLabel }}
            </NTag>
            <span class="meta-text">
              {{
                t('jobs.taskCount', {
                  completed: job.completed_tasks ?? 0,
                  total: job.total_tasks ?? 0
                })
              }}
            </span>
            <NTag v-if="(job.failed_tasks as number) > 0" type="error" size="small" round>
              {{ t('jobs.failedCount', { count: job.failed_tasks }) }}
            </NTag>
          </NSpace>
        </div>
      </div>
      <OverflowActionMenu
        :actions="actions"
        :menu-label="t('common.moreActions')"
        :confirm-positive-text="t('common.delete')"
        :confirm-negative-text="t('common.cancel')"
        @select="handleAction"
      />
    </div>

    <NProgress
      v-if="(job.total_tasks as number) > 0"
      type="line"
      :percentage="progress"
      :show-indicator="false"
      style="margin-top: 8px"
      :status="
        job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'default'
      "
    />

    <NSpace size="small" class="job-card__primary-action">
      <NButton
        v-if="job.status === 'draft' || job.status === 'queued'"
        size="tiny"
        type="primary"
        :disabled="!isConnected || isProcessing"
        @click="$emit('start')"
      >
        {{ t('batch.actions.start') }}
      </NButton>
      <NButton
        v-if="job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'"
        size="tiny"
        quaternary
        type="warning"
        :disabled="isProcessing"
        @click="$emit('rerun')"
      >
        {{ t('batch.actions.rerun') }}
      </NButton>
    </NSpace>
  </NCard>
</template>

<style scoped>
.job-card {
  min-width: 0;
  border-radius: var(--radius-md);
}

.job-card__header,
.job-card__identity {
  display: flex;
  align-items: flex-start;
}

.job-card__header {
  justify-content: space-between;
  gap: 10px;
}

.job-card__identity,
.job-card__copy {
  min-width: 0;
}

.job-card__identity,
.job-card__copy {
  flex: 1;
}

.job-card__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-drag-handle {
  cursor: grab;
  padding: 2px 9px 0 0;
  color: var(--app-text-subtle);
  font-size: 14px;
}

.job-card__primary-action {
  margin-top: 12px;
}
</style>
