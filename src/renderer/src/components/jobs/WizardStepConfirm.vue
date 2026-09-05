<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NInputNumber,
  NSelect,
  NSlider,
  NSpace,
  NStatistic,
  NSwitch,
  NTag
} from 'naive-ui'
import type { BatchResources, ModuleSelectionUI, TaskPreview, VariableOverride } from './types'

defineProps<{
  showSummary?: boolean
  moduleSelections: ModuleSelectionUI[]
  taskPreview: TaskPreview
  batchResources: BatchResources | null
  varTypeLabels: Record<string, string>
}>()

const variableOverrides = defineModel<VariableOverride[]>('variableOverrides', { required: true })
const showOverrides = defineModel<boolean>('showOverrides', { required: true })
const outputPattern = defineModel<string>('outputPattern', { required: true })
const filePattern = defineModel<string>('filePattern', { required: true })
const { t } = useI18n()
</script>

<template>
  <div>
    <!-- Preview stats -->
    <NGrid v-if="showSummary !== false" :cols="3" :x-gap="16" style="margin-bottom: 16px">
      <NGridItem>
        <NStatistic
          :label="t('batch.wizard.moduleDimensions')"
          :value="moduleSelections.filter((s) => s.selectedItemIds.length > 0).length"
        />
      </NGridItem>
      <NGridItem>
        <NStatistic
          :label="t('batch.wizard.totalCombinationsShort')"
          :value="taskPreview.totalCombinations"
        />
      </NGridItem>
      <NGridItem>
        <NStatistic :label="t('batch.wizard.totalImagesShort')">
          <span
            :style="{
              color: taskPreview.totalTasks > 10000 ? '#e88080' : undefined,
              fontWeight: 'bold'
            }"
          >
            {{ taskPreview.totalTasks.toLocaleString() }}
          </span>
        </NStatistic>
      </NGridItem>
    </NGrid>

    <NAlert
      v-if="showSummary !== false && taskPreview.totalTasks > 10000"
      type="warning"
      style="margin-bottom: 12px"
    >
      {{
        t('batch.wizard.tooManyWarningShort', {
          count: taskPreview.totalTasks.toLocaleString()
        })
      }}
    </NAlert>

    <!-- Variable overrides -->
    <div v-if="variableOverrides.length > 0" style="margin-bottom: 16px">
      <NSpace
        align="center"
        :size="6"
        style="margin-bottom: 8px; cursor: pointer; user-select: none"
        @click="showOverrides = !showOverrides"
      >
        <span
          style="font-size: 12px; opacity: 0.6; transition: transform 0.15s"
          :style="{
            display: 'inline-block',
            transform: showOverrides ? 'rotate(90deg)' : 'rotate(0)'
          }"
          >▶</span
        >
        <span style="font-weight: 600">{{ t('batch.wizard.overrideOptional') }}</span>
        <NTag
          v-if="variableOverrides.filter((v) => v.enabled).length > 0"
          size="tiny"
          type="info"
          round
        >
          {{
            t('batch.wizard.overrideCount', {
              count: variableOverrides.filter((v) => v.enabled).length
            })
          }}
        </NTag>
      </NSpace>
      <div v-show="showOverrides">
        <div
          v-for="vo in variableOverrides"
          :key="vo.variableId"
          style="
            padding: 8px 10px;
            border-radius: 8px;
            background: rgba(128, 128, 128, 0.06);
            margin-bottom: 6px;
          "
        >
          <NSpace align="center" justify="space-between">
            <NSpace align="center" :size="8">
              <NSwitch v-model:value="vo.enabled" size="small" />
              <NTag
                size="small"
                :type="
                  vo.varType === 'model' ? 'success' : vo.varType === 'lora' ? 'warning' : 'default'
                "
                round
              >
                {{ varTypeLabels[vo.varType] || vo.varType }}
              </NTag>
              <span :style="{ opacity: vo.enabled ? 1 : 0.5, fontSize: '13px' }">{{
                vo.displayName
              }}</span>
            </NSpace>
            <span v-if="!vo.enabled" style="font-size: 11px; opacity: 0.4">{{
              vo.defaultValue || t('batch.wizard.defaultValueShort')
            }}</span>
          </NSpace>
          <div v-if="vo.enabled" style="margin-top: 6px">
            <NSelect
              v-if="vo.varType === 'model'"
              v-model:value="vo.value"
              :options="(batchResources?.checkpoints || []).map((c) => ({ label: c, value: c }))"
              filterable
              size="small"
              :fallback-option="(v: string) => ({ label: v, value: v })"
            />
            <NSelect
              v-else-if="vo.varType === 'lora'"
              v-model:value="vo.value"
              :options="(batchResources?.loras || []).map((l) => ({ label: l, value: l }))"
              filterable
              size="small"
              :fallback-option="(v: string) => ({ label: v, value: v })"
            />
            <NSpace
              v-else-if="
                vo.varType === 'number' &&
                (vo.fieldName === 'strength_model' || vo.fieldName === 'strength_clip')
              "
              align="center"
            >
              <NSlider
                :value="Number(vo.value) || 1"
                :min="0"
                :max="2"
                :step="0.05"
                style="width: 200px"
                @update:value="
                  (v: number) => {
                    vo.value = String(v)
                  }
                "
              />
              <NInputNumber
                :value="Number(vo.value) || 1"
                :min="0"
                :max="2"
                :step="0.05"
                size="small"
                style="width: 100px"
                @update:value="
                  (v: number | null) => {
                    vo.value = String(v ?? 1)
                  }
                "
              />
            </NSpace>
            <NSelect
              v-else-if="vo.fieldName === 'sampler_name'"
              v-model:value="vo.value"
              :options="(batchResources?.samplers || []).map((s) => ({ label: s, value: s }))"
              filterable
              size="small"
              :fallback-option="(v: string) => ({ label: v, value: v })"
            />
            <NSelect
              v-else-if="vo.fieldName === 'scheduler'"
              v-model:value="vo.value"
              :options="(batchResources?.schedulers || []).map((s) => ({ label: s, value: s }))"
              filterable
              size="small"
              :fallback-option="(v: string) => ({ label: v, value: v })"
            />
            <NInputNumber
              v-else-if="vo.varType === 'number'"
              :value="Number(vo.value) || 0"
              size="small"
              style="width: 200px"
              @update:value="
                (v: number | null) => {
                  vo.value = String(v ?? 0)
                }
              "
            />
            <NInput
              v-else
              v-model:value="vo.value"
              size="small"
              :placeholder="t('batch.wizard.overrideValuePlaceholder')"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Output patterns -->
    <div style="font-weight: 600; margin-bottom: 8px">
      {{ t('batch.wizard.outputSettings') }}
    </div>
    <NGrid :cols="2" :x-gap="16">
      <NGridItem>
        <NFormItem :label="t('batch.wizard.folderPattern')" label-placement="top">
          <NInput
            v-model:value="outputPattern"
            size="small"
            placeholder="{job}/{character}/{outfit}/{emotion}"
          />
        </NFormItem>
      </NGridItem>
      <NGridItem>
        <NFormItem :label="t('batch.wizard.filePattern')" label-placement="top">
          <NInput
            v-model:value="filePattern"
            size="small"
            placeholder="{character}_{outfit}_{emotion}_{index}"
          />
        </NFormItem>
      </NGridItem>
    </NGrid>
    <div style="font-size: 11px; opacity: 0.5; margin-top: -8px">
      {{ t('batch.wizard.availableVars', { lbrace: '{', rbrace: '}' }) }}
    </div>
  </div>
</template>
