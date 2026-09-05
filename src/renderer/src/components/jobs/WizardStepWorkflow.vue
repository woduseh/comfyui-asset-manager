<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NAlert, NForm, NFormItem, NGrid, NGridItem, NInput, NInputNumber, NSelect } from 'naive-ui'
import type { SeedMode } from './types'

defineProps<{
  disabled?: boolean
  workflowOptions: Array<{ label: string; value: string }>
  generationWorkflowHint: string | null
  seedModeOptions: Array<{ label: string; value: string }>
}>()

const { t } = useI18n()
const batchName = defineModel<string>('batchName', { required: true })
const selectedWorkflowId = defineModel<string | null>('selectedWorkflowId', { required: true })
const batchDescription = defineModel<string>('batchDescription', { required: true })
const countPerCombination = defineModel<number>('countPerCombination', { required: true })
const seedMode = defineModel<SeedMode>('seedMode', { required: true })
const fixedSeed = defineModel<number>('fixedSeed', { required: true })
</script>

<template>
  <div>
    <NForm label-placement="top" :disabled="disabled">
      <NGrid :cols="2" :x-gap="16">
        <NGridItem>
          <NFormItem :label="t('batch.wizard.jobNameLabel')" required>
            <NInput
              v-model:value="batchName"
              :placeholder="t('batch.wizard.nameExamplePlaceholder')"
              :aria-label="t('batch.wizard.jobNameLabel')"
            />
          </NFormItem>
        </NGridItem>
        <NGridItem>
          <NFormItem :label="t('batch.wizard.workflowLabel')" required>
            <div style="width: 100%">
              <NSelect
                v-model:value="selectedWorkflowId"
                :options="workflowOptions"
                :placeholder="t('batch.wizard.workflowPlaceholder')"
                :aria-label="t('batch.wizard.workflowLabel')"
              />
              <NAlert
                v-if="generationWorkflowHint"
                type="info"
                :show-icon="false"
                :bordered="false"
                style="margin-top: 8px"
              >
                {{ generationWorkflowHint }}
              </NAlert>
            </div>
          </NFormItem>
        </NGridItem>
      </NGrid>
      <NFormItem :label="t('batch.wizard.descriptionLabel')">
        <NInput
          v-model:value="batchDescription"
          :placeholder="t('batch.wizard.optionalPlaceholder')"
          :aria-label="t('batch.wizard.descriptionLabel')"
        />
      </NFormItem>
      <NGrid :cols="3" :x-gap="16">
        <NGridItem>
          <NFormItem :label="t('batch.wizard.countLabel')">
            <NInputNumber
              v-model:value="countPerCombination"
              :min="1"
              :max="10000"
              :aria-label="t('batch.wizard.countLabel')"
              style="width: 100%"
            />
          </NFormItem>
        </NGridItem>
        <NGridItem>
          <NFormItem :label="t('batch.wizard.seedModeLabel')">
            <NSelect
              v-model:value="seedMode"
              :options="seedModeOptions"
              :aria-label="t('batch.wizard.seedModeLabel')"
            />
          </NFormItem>
        </NGridItem>
        <NGridItem v-if="seedMode !== 'random'">
          <NFormItem :label="t('batch.wizard.seedValueLabel')">
            <NInputNumber
              v-model:value="fixedSeed"
              :min="0"
              :max="2147483647"
              :aria-label="t('batch.wizard.seedValueLabel')"
              style="width: 100%"
            />
          </NFormItem>
        </NGridItem>
      </NGrid>
    </NForm>
  </div>
</template>
