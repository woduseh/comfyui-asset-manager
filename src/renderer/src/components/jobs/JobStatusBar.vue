<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CheckmarkCircleOutline,
  CloudOfflineOutline,
  EllipseOutline,
  PauseOutline,
  PauseCircleOutline,
  PlayOutline,
  StopOutline,
  SyncOutline
} from '@vicons/ionicons5'
import { NAlert, NButton, NIcon, NProgress, NTag } from 'naive-ui'
import ConfirmActionButton from '@renderer/components/common/ConfirmActionButton'

const props = defineProps<{
  job: Record<string, unknown>
  isPaused: boolean
  isConnected: boolean
  eta: string | null
  avgTaskDurationMs?: number | null
}>()

defineEmits<{
  pause: []
  resume: []
  cancel: []
  reconnect: []
}>()

const { t } = useI18n()

const total = computed(() => Number(props.job.total_tasks) || 0)
const completed = computed(() => Number(props.job.completed_tasks) || 0)
const failed = computed(() => Number(props.job.failed_tasks) || 0)
const isDisconnected = computed(() => !props.isConnected)
const percentage = computed(() =>
  total.value > 0 ? Math.round((completed.value / total.value) * 100) : 0
)
const throughput = computed(() => {
  if (!props.avgTaskDurationMs || props.avgTaskDurationMs <= 0) return '—'
  const imagesPerMinute = 60000 / props.avgTaskDurationMs
  return t('jobs.production.imagesPerMinute', { count: imagesPerMinute.toFixed(1) })
})
const elapsed = computed(() => {
  const startedAt = props.job.started_at
  if (typeof startedAt !== 'string' || !startedAt) return '—'
  const start = new Date(startedAt.includes('T') ? startedAt : `${startedAt.replace(' ', 'T')}Z`)
  if (Number.isNaN(start.getTime())) return '—'
  const totalMinutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('jobs.time.hours', { hours, mins: minutes })
    : t('jobs.production.minutesElapsed', { count: minutes })
})

const stages = computed(() => {
  const currentState = isDisconnected.value ? 'interrupted' : props.isPaused ? 'paused' : 'active'
  if (percentage.value >= 100) {
    return [
      { key: 'prompt', label: t('jobs.production.stages.prompt'), state: 'complete' },
      { key: 'assets', label: t('jobs.production.stages.assets'), state: 'complete' },
      { key: 'generation', label: t('jobs.production.stages.generation'), state: 'complete' },
      { key: 'postprocess', label: t('jobs.production.stages.postprocess'), state: 'complete' },
      { key: 'save', label: t('jobs.production.stages.save'), state: 'complete' }
    ]
  }
  if (percentage.value <= 0) {
    return [
      { key: 'prompt', label: t('jobs.production.stages.prompt'), state: currentState },
      { key: 'assets', label: t('jobs.production.stages.assets'), state: 'waiting' },
      { key: 'generation', label: t('jobs.production.stages.generation'), state: 'waiting' },
      { key: 'postprocess', label: t('jobs.production.stages.postprocess'), state: 'waiting' },
      { key: 'save', label: t('jobs.production.stages.save'), state: 'waiting' }
    ]
  }
  return [
    { key: 'prompt', label: t('jobs.production.stages.prompt'), state: 'complete' },
    { key: 'assets', label: t('jobs.production.stages.assets'), state: 'complete' },
    {
      key: 'generation',
      label: t('jobs.production.stages.generation'),
      state: currentState
    },
    { key: 'postprocess', label: t('jobs.production.stages.postprocess'), state: 'waiting' },
    { key: 'save', label: t('jobs.production.stages.save'), state: 'waiting' }
  ]
})
</script>

<template>
  <section class="active-run" :aria-label="t('jobs.production.activeRun')">
    <header class="active-run__header">
      <div class="active-run__identity">
        <span class="section-eyebrow">{{ t('jobs.production.activeRun') }}</span>
        <div class="active-run__title-row">
          <h2>{{ job.name }}</h2>
          <NTag
            :type="isDisconnected ? 'warning' : isPaused ? 'default' : 'info'"
            size="small"
            :bordered="false"
          >
            {{
              isDisconnected
                ? t('jobs.production.interrupted')
                : isPaused
                  ? t('queue.statusPaused')
                  : t('queue.statusRunning')
            }}
          </NTag>
        </div>
        <p>
          {{ completed.toLocaleString() }} / {{ total.toLocaleString() }}
          {{ t('jobs.production.imagesUnit') }}
        </p>
      </div>
      <div class="active-run__actions">
        <NButton v-if="!isPaused" secondary :disabled="isDisconnected" @click="$emit('pause')">
          <template #icon><NIcon :component="PauseOutline" /></template>
          {{ t('batch.actions.pause') }}
        </NButton>
        <NButton
          v-else
          secondary
          type="primary"
          :disabled="isDisconnected"
          @click="$emit('resume')"
        >
          <template #icon><NIcon :component="PlayOutline" /></template>
          {{ t('batch.actions.resume') }}
        </NButton>
        <ConfirmActionButton
          secondary
          type="error"
          :label="t('batch.actions.cancel')"
          :confirm-text="t('batch.confirmCancel')"
          @confirm="$emit('cancel')"
        >
          <template #icon><NIcon :component="StopOutline" /></template>
        </ConfirmActionButton>
      </div>
    </header>

    <NAlert
      v-if="isDisconnected"
      class="active-run__connection-alert"
      type="warning"
      :title="t('jobs.production.connectionLost')"
      :bordered="false"
    >
      <div class="active-run__connection-copy">
        <span>{{ t('jobs.production.connectionLostHint') }}</span>
        <NButton size="small" type="warning" secondary @click="$emit('reconnect')">
          <template #icon><NIcon :component="CloudOfflineOutline" /></template>
          {{ t('jobs.production.reconnect') }}
        </NButton>
      </div>
    </NAlert>

    <div class="active-run__progress-copy">
      <span>{{ t('jobs.production.generationProgress') }}</span>
      <strong>{{ percentage }}%</strong>
    </div>
    <NProgress
      type="line"
      :percentage="percentage"
      :show-indicator="false"
      :height="7"
      status="info"
    />

    <div class="active-run__metrics">
      <div>
        <span>{{ t('jobs.production.eta') }}</span>
        <strong>{{ eta || '—' }}</strong>
      </div>
      <div>
        <span>{{ t('jobs.production.throughput') }}</span>
        <strong>{{ throughput }}</strong>
      </div>
      <div>
        <span>{{ t('jobs.production.elapsed') }}</span>
        <strong>{{ elapsed }}</strong>
      </div>
      <div>
        <span>{{ t('jobs.production.failures') }}</span>
        <strong :class="{ 'active-run__failure': failed > 0 }">{{ failed }}</strong>
      </div>
    </div>

    <div class="active-run__stages" :aria-label="t('jobs.production.pipeline')">
      <div
        v-for="(stage, index) in stages"
        :key="stage.key"
        class="active-run__stage"
        :class="`active-run__stage--${stage.state}`"
      >
        <span v-if="index > 0" class="active-run__connector" aria-hidden="true" />
        <NIcon
          :component="
            stage.state === 'complete'
              ? CheckmarkCircleOutline
              : stage.state === 'active'
                ? SyncOutline
                : stage.state === 'interrupted'
                  ? CloudOfflineOutline
                  : stage.state === 'paused'
                    ? PauseCircleOutline
                    : EllipseOutline
          "
          :size="18"
        />
        <span>{{ stage.label }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.active-run {
  padding: 22px 24px 20px;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
}

.active-run__header,
.active-run__title-row,
.active-run__actions,
.active-run__progress-copy {
  display: flex;
  align-items: center;
}

.active-run__header {
  justify-content: space-between;
  gap: 24px;
}

.active-run__identity {
  min-width: 0;
}

.active-run__title-row {
  gap: 10px;
  margin-top: 5px;
}

.active-run h2 {
  overflow: hidden;
  margin: 0;
  font-size: 21px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-run__identity p {
  margin-top: 5px;
  color: var(--app-text-subtle);
  font-size: 12px;
}

.active-run__actions {
  flex: 0 0 auto;
  gap: 8px;
}

.active-run__connection-alert {
  margin-top: 18px;
}

.active-run__connection-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.active-run__progress-copy {
  justify-content: space-between;
  margin: 24px 0 8px;
  color: var(--app-text-muted);
  font-size: 12px;
}

.active-run__progress-copy strong {
  color: var(--app-text-primary);
  font-variant-numeric: tabular-nums;
}

.active-run__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 18px;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--app-surface-muted);
}

.active-run__metrics > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 13px 15px;
  border-left: 1px solid var(--app-border-subtle);
}

.active-run__metrics > div:first-child {
  border-left: 0;
}

.active-run__metrics span {
  color: var(--app-text-subtle);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.active-run__metrics strong {
  overflow: hidden;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-run__failure {
  color: var(--app-danger);
}

.active-run__stages {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 20px;
}

.active-run__stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--app-text-subtle);
  font-size: 11px;
  white-space: nowrap;
}

.active-run__stage--complete {
  color: var(--app-success);
}

.active-run__stage--active {
  color: var(--app-accent-blue);
}

.active-run__stage--paused {
  color: var(--app-text-muted);
}

.active-run__stage--interrupted {
  color: var(--app-warning);
}

.active-run__connector {
  position: absolute;
  top: 50%;
  right: calc(50% + 56px);
  left: calc(-50% + 56px);
  height: 1px;
  background: var(--app-border);
}

@media (max-width: 760px) {
  .active-run {
    padding: 18px;
  }

  .active-run__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .active-run__connection-copy {
    align-items: flex-start;
    flex-direction: column;
  }

  .active-run__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .active-run__metrics > div:nth-child(3) {
    border-top: 1px solid var(--app-border-subtle);
    border-left: 0;
  }

  .active-run__metrics > div:nth-child(4) {
    border-top: 1px solid var(--app-border-subtle);
  }

  .active-run__stages {
    grid-template-columns: 1fr;
    gap: 9px;
  }

  .active-run__stage {
    justify-content: flex-start;
  }

  .active-run__connector {
    display: none;
  }
}
</style>
