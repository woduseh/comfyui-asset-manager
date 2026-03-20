/**
 * Shared batch wizard utility functions.
 * Extracted from BatchView.vue and JobsView.vue to eliminate ~200 lines of duplication.
 */
import type { Ref } from 'vue'

const RESTORE_DELAY_MS = 500

export interface ModuleSelection {
  moduleId: string
  moduleName: string
  moduleType: string
  items: Array<{ id: string; enabled: boolean | number; [key: string]: unknown }>
  selectedItemIds: string[]
}

export interface SlotMapping {
  nodeId: string
  fieldName: string
  action: string
  fixedValue: string
  assignedModuleIds: string[]
  prefixModuleIds: string[]
  prefixText: string
  suffixText: string
  promptVariant?: string
  userPrefixText?: string
  [key: string]: unknown
}

export interface VariableOverride {
  nodeId: string
  fieldName: string
  enabled: boolean
  value: string
  [key: string]: unknown
}

export interface ModuleStore {
  loadItems: (moduleId: string) => Promise<void>
  currentItems: Array<{ id: string; enabled: boolean | number; [key: string]: unknown }>
}

export interface AvailableModule {
  id: string
  name: string
  type: string
  [key: string]: unknown
}

/** Add a module to the batch matrix selection */
export async function addModuleToMatrix(
  moduleId: string,
  moduleSelections: Ref<ModuleSelection[]>,
  availableModules: Ref<AvailableModule[]>,
  moduleStore: ModuleStore,
  moduleToAdd: Ref<string | null>
): Promise<void> {
  if (!moduleId || moduleSelections.value.some((s) => s.moduleId === moduleId)) return
  const mod = availableModules.value.find((m) => m.id === moduleId)
  if (!mod) return
  await moduleStore.loadItems(moduleId)
  const items = [...moduleStore.currentItems]
  moduleSelections.value.push({
    moduleId,
    moduleName: mod.name,
    moduleType: mod.type,
    items,
    selectedItemIds: items.filter((i) => i.enabled).map((i) => i.id)
  })
  moduleToAdd.value = null
}

/** Restore module selections from a saved batch config */
export async function restoreModuleSelections(
  config: {
    moduleSelections?: Array<{ moduleId: string; moduleType?: string; selectedItemIds?: string[] }>
  },
  moduleSelections: Ref<ModuleSelection[]>,
  availableModules: Ref<AvailableModule[]>,
  moduleStore: ModuleStore
): Promise<void> {
  moduleSelections.value = []
  if (!config.moduleSelections || !Array.isArray(config.moduleSelections)) return

  for (const sel of config.moduleSelections) {
    const mod = availableModules.value.find((m) => m.id === sel.moduleId)
    if (mod) {
      await moduleStore.loadItems(sel.moduleId)
      const items = [...moduleStore.currentItems]
      moduleSelections.value.push({
        moduleId: sel.moduleId,
        moduleName: mod.name,
        moduleType: sel.moduleType || mod.type,
        items,
        selectedItemIds: sel.selectedItemIds || items.map((i) => i.id)
      })
    }
  }
}

/** Restore slot mappings from a saved batch config (delayed to run after watcher) */
export function restoreSlotMappings(
  savedSlots: Array<Record<string, unknown>> | undefined,
  slotMappings: Ref<SlotMapping[]>,
  opts?: { useUserPrefixText?: boolean }
): void {
  if (!savedSlots || !Array.isArray(savedSlots)) return

  setTimeout(() => {
    for (const saved of savedSlots) {
      const slot = slotMappings.value.find(
        (s) => s.nodeId === saved.nodeId && s.fieldName === saved.fieldName
      )
      if (slot) {
        slot.action = (saved.action as string) || 'inject'
        slot.fixedValue = (saved.fixedValue as string) || ''
        slot.assignedModuleIds = (saved.assignedModuleIds as string[]) || []
        slot.prefixModuleIds = (saved.prefixModuleIds as string[]) || []
        slot.suffixText = (saved.suffixText as string) || ''
        slot.promptVariant = (saved.promptVariant as string) || ''
        // JobsView uses userPrefixText for original user-entered text preservation
        if (opts?.useUserPrefixText) {
          slot.prefixText = (saved.userPrefixText as string) ?? (saved.prefixText as string) ?? ''
        } else {
          slot.prefixText = (saved.prefixText as string) || ''
        }
      }
    }
  }, RESTORE_DELAY_MS)
}

/** Restore variable overrides from a saved batch config (delayed to run after watcher) */
export function restoreVariableOverrides(
  savedOverrides: Array<Record<string, unknown>> | undefined,
  variableOverrides: Ref<VariableOverride[]>,
  showOverrides?: Ref<boolean>
): void {
  if (!savedOverrides || !Array.isArray(savedOverrides) || savedOverrides.length === 0) {
    if (showOverrides) showOverrides.value = false
    return
  }
  if (showOverrides) showOverrides.value = true

  setTimeout(() => {
    for (const saved of savedOverrides) {
      const vo = variableOverrides.value.find(
        (v) => v.nodeId === saved.nodeId && v.fieldName === saved.fieldName
      )
      if (vo) {
        vo.enabled = true
        vo.value = (saved.value as string) || ''
      }
    }
  }, RESTORE_DELAY_MS)
}
