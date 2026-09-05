<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronDownOutline,
  ChevronUpOutline,
  CopyOutline,
  CreateOutline,
  PlayOutline,
  TrashOutline
} from '@vicons/ionicons5'
import { NButton, NIcon, NProgress, NTag } from 'naive-ui'
import OverflowActionMenu, {
  type OverflowAction
} from '@renderer/components/common/OverflowActionMenu.vue'
import { getJobStatusType } from '@renderer/utils/status-presentation'

withDefaults(
  defineProps<{
    jobs: Record<string, unknown>[]
    statusLabels: Record<string, string>
    isConnected: boolean
    isProcessing: boolean
    reorderable?: boolean
  }>(),
  { reorderable: false }
)

const emit = defineEmits<{
  start: [jobId: string]
  rerun: [job: Record<string, unknown>]
  edit: [job: Record<string, unknown>]
  clone: [job: Record<string, unknown>]
  delete: [jobId: string]
  move: [jobId: string, direction: 'up' | 'down']
}>()

const { t, locale } = useI18n()

const dateFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'ko' ? 'ko-KR' : 'en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
)

function progress(job: Record<string, unknown>): number {
  const total = Number(job.total_tasks) || 0
  const completed = Number(job.completed_tasks) || 0
  return total > 0 ? Math.round((completed / total) * 100) : 0
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : dateFormatter.value.format(date)
}

function actionsFor(job: Record<string, unknown>): OverflowAction[] {
  const actions: OverflowAction[] = []
  if (job.status === 'draft') {
    actions.push({ key: 'edit', label: t('batch.actions.edit'), icon: CreateOutline })
  }
  actions.push(
    { key: 'clone', label: t('batch.actions.clone'), icon: CopyOutline },
    {
      key: 'delete',
      label: t('batch.actions.delete'),
      icon: TrashOutline,
      danger: true,
      disabled: Number(job.uncertain_tasks) > 0,
      confirmText: t('batch.confirmDelete')
    }
  )
  return actions
}

function handleAction(action: string, job: Record<string, unknown>): void {
  if (action === 'edit') emit('edit', job)
  if (action === 'clone') emit('clone', job)
  if (action === 'delete') emit('delete', job.id as string)
}
</script>

<template>
  <div class="production-table" role="table" :aria-label="t('jobs.production.history')">
    <div class="production-table__header" role="row">
      <span>{{ t('jobs.production.job') }}</span>
      <span>{{ t('common.status') }}</span>
      <span>{{ t('jobs.production.progress') }}</span>
      <span>{{ t('jobs.production.updated') }}</span>
      <span class="production-table__actions-label">{{ t('common.actions') }}</span>
    </div>

    <div
      v-for="(job, index) in jobs"
      :key="job.id as string"
      class="production-table__row"
      role="row"
    >
      <div class="production-table__name" role="cell">
        <strong :title="job.name as string">{{ job.name }}</strong>
        <span
          >{{ Number(job.total_tasks || 0).toLocaleString()
          }}{{ t('jobs.production.imagesUnit') }}</span
        >
        <span v-if="Number(job.uncertain_tasks) > 0" role="status">
          {{ t('jobs.production.needsReview') }}: {{ t('jobs.production.needsReviewHint') }}
        </span>
      </div>
      <div role="cell">
        <NTag :type="getJobStatusType(job.status as string)" size="small" :bordered="false">
          {{ statusLabels[job.status as string] || job.status }}
        </NTag>
      </div>
      <div class="production-table__progress" role="cell">
        <div class="production-table__progress-copy">
          <span
            >{{ Number(job.completed_tasks || 0).toLocaleString() }} /
            {{ Number(job.total_tasks || 0).toLocaleString() }}</span
          >
          <span>{{ progress(job) }}%</span>
        </div>
        <NProgress type="line" :percentage="progress(job)" :show-indicator="false" :height="4" />
      </div>
      <span class="production-table__date" role="cell">
        {{ formatDate(job.completed_at || job.created_at) }}
      </span>
      <div class="production-table__actions" role="cell">
        <div v-if="reorderable" class="production-table__reorder">
          <NButton
            size="tiny"
            quaternary
            :disabled="index === 0"
            :aria-label="t('jobs.production.moveUp')"
            :title="t('jobs.production.moveUp')"
            @click="$emit('move', job.id as string, 'up')"
          >
            <template #icon><NIcon :component="ChevronUpOutline" /></template>
          </NButton>
          <NButton
            size="tiny"
            quaternary
            :disabled="index === jobs.length - 1"
            :aria-label="t('jobs.production.moveDown')"
            :title="t('jobs.production.moveDown')"
            @click="$emit('move', job.id as string, 'down')"
          >
            <template #icon><NIcon :component="ChevronDownOutline" /></template>
          </NButton>
        </div>
        <NButton
          v-if="job.status === 'draft' || job.status === 'queued'"
          size="small"
          secondary
          type="primary"
          :disabled="!isConnected || isProcessing || Number(job.uncertain_tasks) > 0"
          @click="$emit('start', job.id as string)"
        >
          <template #icon><NIcon :component="PlayOutline" /></template>
          {{ t('batch.actions.start') }}
        </NButton>
        <NButton
          v-else-if="
            job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
          "
          size="small"
          quaternary
          :disabled="isProcessing || Number(job.uncertain_tasks) > 0"
          @click="$emit('rerun', job)"
        >
          {{ t('batch.actions.rerun') }}
        </NButton>
        <OverflowActionMenu
          :actions="actionsFor(job)"
          :menu-label="t('common.moreActions')"
          :confirm-positive-text="t('common.delete')"
          :confirm-negative-text="t('common.cancel')"
          @select="(action) => handleAction(action, job)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.production-table {
  border-top: 1px solid var(--app-border);
}

.production-table__header,
.production-table__row {
  display: grid;
  grid-template-columns: minmax(220px, 1.55fr) 100px minmax(180px, 1fr) 130px 176px;
  align-items: center;
  column-gap: 16px;
}

.production-table__header {
  min-height: 38px;
  color: var(--app-text-subtle);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.production-table__row {
  min-height: 64px;
  border-top: 1px solid var(--app-border-subtle);
}

.production-table__row:hover {
  background: var(--app-surface-hover);
}

.production-table__name {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.production-table__name strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.production-table__name span,
.production-table__date {
  color: var(--app-text-subtle);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.production-table__progress-copy {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  color: var(--app-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.production-table__actions,
.production-table__actions-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.production-table__reorder {
  display: inline-flex;
  align-items: center;
}

@media (max-width: 1040px) {
  .production-table__header,
  .production-table__row {
    grid-template-columns: minmax(180px, 1.5fr) 90px minmax(150px, 1fr) 158px;
  }

  .production-table__date {
    display: none;
  }
}

@media (max-width: 760px) {
  .production-table__header {
    display: none;
  }

  .production-table__row {
    grid-template-columns: 1fr auto;
    gap: 10px;
    padding: 12px 0;
  }

  .production-table__progress {
    grid-column: 1 / -1;
  }

  .production-table__actions {
    grid-column: 1 / -1;
    grid-row: auto;
    justify-content: flex-start;
  }
}
</style>
