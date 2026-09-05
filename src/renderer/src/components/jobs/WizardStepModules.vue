<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NGrid,
  NGridItem,
  NInput,
  NSelect,
  NSpace,
  NTag
} from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import type { ModuleItem, PromptModule } from '@renderer/stores/module.store'
import { invokeIpc } from '@renderer/utils/ipc'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ModuleSelectionUI, SlotMapping } from './types'

const props = defineProps<{ availableModules: PromptModule[] }>()
const moduleSelections = defineModel<ModuleSelectionUI[]>('moduleSelections', { required: true })
const moduleToAdd = defineModel<string | null>('moduleToAdd', { required: true })
const slotMappings = defineModel<SlotMapping[]>('slotMappings', { required: true })
const { t } = useI18n()

async function addModuleToMatrix(moduleId: string): Promise<void> {
  if (!moduleId || moduleSelections.value.some((selection) => selection.moduleId === moduleId)) {
    return
  }
  const module = props.availableModules.find((candidate) => candidate.id === moduleId)
  if (!module) return

  const items = (await invokeIpc(IPC_CHANNELS.MODULE_ITEM_LIST, { moduleId })) as ModuleItem[]
  moduleSelections.value.push({
    moduleId,
    moduleName: module.name,
    moduleType: module.type,
    items,
    selectedItemIds: items.filter((item) => item.enabled).map((item) => item.id)
  })
  moduleToAdd.value = null
}

function removeModuleFromMatrix(moduleId: string): void {
  moduleSelections.value = moduleSelections.value.filter(
    (selection) => selection.moduleId !== moduleId
  )
}

function getModuleName(moduleId: string): string {
  return (
    props.availableModules.find((module) => module.id === moduleId)?.name ?? moduleId.slice(0, 8)
  )
}

function removePrefixModule(slot: SlotMapping, moduleId: string): void {
  slot.prefixModuleIds = slot.prefixModuleIds.filter((id) => id !== moduleId)
}

function addPrefixModule(slot: SlotMapping, moduleId: string | null): void {
  if (!moduleId || slot.prefixModuleIds.includes(moduleId)) return
  slot.prefixModuleIds.push(moduleId)
}
</script>

<template>
  <div>
    <NGrid cols="1 540:2" :x-gap="16">
      <!-- Left: Module matrix -->
      <NGridItem>
        <div style="font-weight: 600; margin-bottom: 8px">
          {{ t('batch.wizard.moduleSection') }}
        </div>
        <NSelect
          v-model:value="moduleToAdd"
          :placeholder="t('batch.wizard.addModuleShortPlaceholder')"
          size="small"
          :options="
            availableModules
              .filter((m) => !moduleSelections.some((s) => s.moduleId === m.id))
              .map((m) => ({
                label: `${m.name} (${t('module.type.' + m.type)})`,
                value: m.id
              }))
          "
          style="margin-bottom: 10px"
          @update:value="addModuleToMatrix"
        />

        <div
          v-for="sel in moduleSelections"
          :key="sel.moduleId"
          style="
            padding: 10px;
            border-radius: 10px;
            background: rgba(128, 128, 128, 0.06);
            margin-bottom: 8px;
          "
        >
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 6px;
            "
          >
            <NSpace align="center" :size="6">
              <NTag size="small" round>{{ t('module.type.' + sel.moduleType) }}</NTag>
              <strong style="font-size: 13px">{{ sel.moduleName }}</strong>
              <span style="font-size: 11px; opacity: 0.5"
                >{{ sel.selectedItemIds.length }}/{{ sel.items.length }}</span
              >
            </NSpace>
            <NSpace :size="2">
              <NButton
                size="tiny"
                quaternary
                @click="sel.selectedItemIds = sel.items.map((i) => i.id)"
                >{{ t('batch.wizard.selectAllShort') }}</NButton
              >
              <NButton size="tiny" quaternary @click="sel.selectedItemIds = []">{{
                t('batch.wizard.deselectAllShort')
              }}</NButton>
              <NButton
                size="tiny"
                quaternary
                type="error"
                @click="removeModuleFromMatrix(sel.moduleId)"
                >✕</NButton
              >
            </NSpace>
          </div>
          <NCheckboxGroup v-model:value="sel.selectedItemIds">
            <NSpace :size="4" :wrap="true">
              <NCheckbox
                v-for="item in sel.items"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              />
            </NSpace>
          </NCheckboxGroup>
          <NAlert
            v-if="sel.items.length === 0"
            type="warning"
            style="margin-top: 6px; font-size: 12px"
          >
            {{ t('batch.wizard.noItemsShort') }}
          </NAlert>
        </div>

        <NAlert v-if="moduleSelections.length === 0" type="info" style="font-size: 12px">
          {{ t('batch.wizard.addModulesHintShort') }}
        </NAlert>
      </NGridItem>

      <!-- Right: Slot mappings -->
      <NGridItem>
        <div style="font-weight: 600; margin-bottom: 8px">
          {{ t('batch.wizard.slotSectionShort') }}
        </div>

        <NAlert
          v-if="slotMappings.length === 0"
          type="info"
          style="font-size: 12px; margin-bottom: 8px"
        >
          {{ t('batch.wizard.noSlotsShort') }}
        </NAlert>

        <div
          v-for="slot in slotMappings"
          :key="slot.variableId"
          style="
            padding: 10px;
            border-radius: 10px;
            background: rgba(128, 128, 128, 0.06);
            margin-bottom: 8px;
          "
        >
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 6px;
            "
          >
            <NSpace align="center" :size="6">
              <NTag
                size="small"
                :type="slot.role === 'prompt_positive' ? 'success' : 'error'"
                round
              >
                {{
                  slot.role === 'prompt_positive'
                    ? t('batch.wizard.positive')
                    : t('batch.wizard.negative')
                }}
              </NTag>
              <span style="font-size: 13px">{{ slot.displayName }}</span>
            </NSpace>
            <NSelect
              v-model:value="slot.action"
              :options="[
                { label: t('batch.wizard.actionInjectShort'), value: 'inject' },
                { label: t('batch.wizard.actionFixedShort'), value: 'fixed' }
              ]"
              size="small"
              style="width: 120px"
            />
          </div>

          <NInput
            v-if="slot.action === 'fixed'"
            v-model:value="slot.fixedValue"
            type="textarea"
            :rows="2"
            size="small"
            :placeholder="t('batch.wizard.fixedPlaceholder')"
          />

          <template v-if="slot.action === 'inject'">
            <div style="margin-bottom: 6px">
              <span style="font-size: 11px; opacity: 0.6">{{
                t('batch.wizard.prefixModulesShort')
              }}</span>
              <NSelect
                :value="null"
                filterable
                size="small"
                :placeholder="t('batch.wizard.prefixModuleShortPlaceholder')"
                :options="
                  availableModules
                    .filter((m) => !slot.prefixModuleIds.includes(m.id))
                    .map((m) => ({
                      label: `${m.name} (${t('module.type.' + m.type)})`,
                      value: m.id
                    }))
                "
                @update:value="(v: string) => addPrefixModule(slot, v)"
              />
              <VueDraggable
                v-if="slot.prefixModuleIds.length > 0"
                v-model="slot.prefixModuleIds"
                :animation="200"
                style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px"
              >
                <NTag
                  v-for="mid in slot.prefixModuleIds"
                  :key="mid"
                  size="small"
                  round
                  closable
                  style="cursor: grab"
                  @close="removePrefixModule(slot, mid)"
                >
                  {{ getModuleName(mid) }}
                </NTag>
              </VueDraggable>
            </div>
            <NInput
              v-model:value="slot.prefixText"
              size="small"
              :placeholder="t('batch.wizard.prefixTextPlaceholder')"
              style="margin-bottom: 6px"
            />
            <div v-if="moduleSelections.length > 0" style="margin-bottom: 6px">
              <span style="font-size: 11px; opacity: 0.6">{{
                t('batch.wizard.matrixModulesShort')
              }}</span>
              <NCheckboxGroup v-model:value="slot.assignedModuleIds">
                <NSpace :size="4" :wrap="true">
                  <NCheckbox
                    v-for="sel in moduleSelections"
                    :key="sel.moduleId"
                    :value="sel.moduleId"
                    :label="sel.moduleName"
                  />
                </NSpace>
              </NCheckboxGroup>
            </div>
            <NInput
              v-model:value="slot.suffixText"
              size="small"
              :placeholder="t('batch.wizard.suffixShortPlaceholder')"
            />
            <NInput
              v-model:value="slot.promptVariant"
              size="small"
              :placeholder="t('batch.slot.variantPlaceholder')"
              style="margin-top: 6px"
            />
          </template>
        </div>
      </NGridItem>
    </NGrid>
  </div>
</template>
