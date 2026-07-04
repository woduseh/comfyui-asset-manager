import type { ModuleItem } from '@renderer/stores/module.store'

export type BatchWizardMode = 'create' | 'edit' | 'clone'
export type SeedMode = 'random' | 'fixed' | 'incremental'

export interface RestorableJobConfig {
  description?: string
  workflowId?: string | null
  countPerCombination?: number
  seedMode?: SeedMode
  fixedSeed?: number
  outputFolderPattern?: string
  fileNamePattern?: string
  moduleSelections?: Array<{ moduleId: string; moduleType?: string; selectedItemIds?: string[] }>
  slotMappings?: Array<Record<string, unknown>>
  variableOverrides?: Array<Record<string, unknown>>
}

export interface ModuleSelectionUI {
  moduleId: string
  moduleName: string
  moduleType: string
  items: ModuleItem[]
  selectedItemIds: string[]
}

export interface SlotMapping {
  variableId: string
  nodeId: string
  fieldName: string
  displayName: string
  role: string
  action: 'inject' | 'fixed'
  fixedValue: string
  assignedModuleIds: string[]
  prefixModuleIds: string[]
  prefixText: string
  suffixText: string
  promptVariant: string
}

export interface VariableOverride {
  variableId: string
  nodeId: string
  fieldName: string
  displayName: string
  varType: string
  role: string
  enabled: boolean
  value: string
  defaultValue: string
}

export interface BatchResources {
  checkpoints: string[]
  loras: string[]
  vaes: string[]
  upscaleModels: string[]
  samplers: string[]
  schedulers: string[]
}

export interface TaskPreview {
  totalCombinations: number
  totalTasks: number
}
