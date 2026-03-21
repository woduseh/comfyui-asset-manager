/**
 * Cartesian Product Generator & Batch Task Builder
 *
 * Takes module selections (character, outfit, emotion, etc.) and generates
 * all combinations as individual batch tasks.
 */

import { buildPrompt } from '../prompt/composition-engine'

export interface BatchModuleSelection {
  moduleId: string
  moduleType: string
  selectedItemIds: string[]
}

export interface BatchConfig {
  name: string
  description?: string
  workflowId: string
  moduleSelections: BatchModuleSelection[]
  countPerCombination: number
  seedMode: 'random' | 'fixed' | 'incremental'
  fixedSeed?: number
  outputFolderPattern: string
  fileNamePattern: string
  extraVariables?: Record<string, string | number>
  slotMappings?: Array<{
    variableId: string
    nodeId: string
    fieldName: string
    role: string
    action: 'inject' | 'fixed'
    fixedValue: string
    assignedModuleIds: string[]
    prefixModuleIds: string[]
    prefixText: string
    userPrefixText?: string
    suffixText: string
    promptVariant?: string
  }>
  variableOverrides?: Array<{
    nodeId: string
    fieldName: string
    value: string
  }>
  pipelineConfig?: {
    steps: Array<{
      workflowId: string
      variableMappings: Record<string, string>
    }>
  }
}

export interface GeneratedTask {
  promptData: {
    positive: string
    negative: string
    seed: number
    extraVariables: Record<string, string | number>
    slotMappings?: Array<{
      nodeId: string
      fieldName: string
      role: string
      action: 'inject' | 'fixed'
      fixedValue: string
      assignedModuleIds: string[]
      prefixModuleIds: string[]
      prefixText: string
      suffixText: string
    }>
    slotPrompts?: Record<string, string>
    variableOverrides?: Array<{
      nodeId: string
      fieldName: string
      value: string
    }>
  }
  metadata: {
    characterName?: string
    outfitName?: string
    emotionName?: string
    styleName?: string
    artistName?: string
    combinationIndex: number
    imageIndex: number
    totalInCombination: number
  }
  sortOrder: number
}

/**
 * Generate all combinations from module selections (cartesian product)
 */
export function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]]
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  )
}

/**
 * Expand batch config into individual tasks
 */
export function expandBatchToTasks(
  config: BatchConfig,
  moduleData: Array<{
    moduleId: string
    moduleType: string
    items: Array<{
      id: string
      name: string
      prompt: string
      negative: string
      weight: number
      enabled: boolean
      prompt_variants?: Record<string, { prompt: string; negative: string }>
    }>
  }>
): GeneratedTask[] {
  // Build the cartesian dimensions
  const dimensions: Array<
    Array<{
      moduleType: string
      item: {
        id: string
        name: string
        prompt: string
        negative: string
        weight: number
        enabled: boolean
        prompt_variants?: Record<string, { prompt: string; negative: string }>
      }
    }>
  > = []
  const dimensionModuleIds: string[] = []

  for (const selection of config.moduleSelections) {
    const modData = moduleData.find((m) => m.moduleId === selection.moduleId)
    if (!modData) continue

    const selectedItems = modData.items.filter(
      (item) => selection.selectedItemIds.includes(item.id) && item.enabled
    )

    if (selectedItems.length === 0) continue

    dimensionModuleIds.push(selection.moduleId)
    dimensions.push(
      selectedItems.map((item) => ({
        moduleType: selection.moduleType,
        item
      }))
    )
  }

  if (dimensions.length === 0) return []

  const combinations = cartesianProduct(dimensions)
  const tasks: GeneratedTask[] = []
  let sortOrder = 0

  for (let comboIdx = 0; comboIdx < combinations.length; comboIdx++) {
    const combo = combinations[comboIdx]

    // Build modules for prompt composition
    const modules = combo.map((entry) => ({
      type: entry.moduleType,
      items: [
        {
          prompt: entry.item.prompt,
          negative: entry.item.negative,
          weight: entry.item.weight,
          enabled: true
        }
      ]
    }))

    // Extract metadata names
    const metadata: GeneratedTask['metadata'] = {
      combinationIndex: comboIdx,
      imageIndex: 0,
      totalInCombination: config.countPerCombination
    }

    for (const entry of combo) {
      switch (entry.moduleType) {
        case 'character':
          metadata.characterName = entry.item.name
          break
        case 'outfit':
          metadata.outfitName = entry.item.name
          break
        case 'emotion':
          metadata.emotionName = entry.item.name
          break
        case 'style':
          metadata.styleName = entry.item.name
          break
        case 'artist':
          metadata.artistName = entry.item.name
          break
      }
    }

    // Generate N images per combination
    for (let imgIdx = 0; imgIdx < config.countPerCombination; imgIdx++) {
      let seed: number
      switch (config.seedMode) {
        case 'fixed':
          seed = config.fixedSeed ?? 42
          break
        case 'incremental':
          seed = (config.fixedSeed ?? 0) + sortOrder
          break
        case 'random':
        default:
          seed = Math.floor(Math.random() * 2147483647)
          break
      }

      const composed = buildPrompt(modules, config.extraVariables as Record<string, string>, seed)

      // Compute per-slot prompts
      const slotPrompts: Record<string, string> = {}
      if (config.slotMappings) {
        for (const slot of config.slotMappings) {
          if (slot.action !== 'inject') continue

          const slotKey = `${slot.nodeId}:${slot.fieldName}`

          if (slot.assignedModuleIds && slot.assignedModuleIds.length > 0) {
            const assignedModules = combo
              .map((entry, idx) => ({ entry, moduleId: dimensionModuleIds[idx] }))
              .filter(({ moduleId }) => slot.assignedModuleIds.includes(moduleId))
              .map(({ entry }) => {
                // Resolve prompt variant if slot specifies one
                const variant = slot.promptVariant
                  ? entry.item.prompt_variants?.[slot.promptVariant]
                  : undefined
                return {
                  type: entry.moduleType,
                  items: [
                    {
                      prompt: variant?.prompt ?? entry.item.prompt,
                      negative: variant?.negative ?? entry.item.negative,
                      weight: entry.item.weight,
                      enabled: true
                    }
                  ]
                }
              })

            if (assignedModules.length > 0) {
              const slotComposed = buildPrompt(
                assignedModules,
                config.extraVariables as Record<string, string>,
                seed
              )
              const promptText =
                slot.role === 'prompt_positive' ? slotComposed.positive : slotComposed.negative

              const parts: string[] = []
              if (slot.prefixText?.trim()) parts.push(slot.prefixText.trim())
              if (promptText.trim()) parts.push(promptText.trim())
              if (slot.suffixText?.trim()) parts.push(slot.suffixText.trim())
              slotPrompts[slotKey] = parts.join(', ')
            } else {
              const parts: string[] = []
              if (slot.prefixText?.trim()) parts.push(slot.prefixText.trim())
              if (slot.suffixText?.trim()) parts.push(slot.suffixText.trim())
              slotPrompts[slotKey] = parts.join(', ')
            }
          } else {
            // No specific modules assigned — use global composed prompt (backward compat)
            const globalPrompt =
              slot.role === 'prompt_positive' ? composed.positive : composed.negative
            const parts: string[] = []
            if (slot.prefixText?.trim()) parts.push(slot.prefixText.trim())
            if (globalPrompt.trim()) parts.push(globalPrompt.trim())
            if (slot.suffixText?.trim()) parts.push(slot.suffixText.trim())
            slotPrompts[slotKey] = parts.join(', ')
          }
        }
      }

      tasks.push({
        promptData: {
          positive: composed.positive,
          negative: composed.negative,
          seed,
          extraVariables: config.extraVariables || {},
          slotMappings: config.slotMappings?.map((s) => ({
            nodeId: s.nodeId,
            fieldName: s.fieldName,
            role: s.role,
            action: s.action,
            fixedValue: s.fixedValue,
            assignedModuleIds: s.assignedModuleIds || [],
            prefixModuleIds: s.prefixModuleIds || [],
            prefixText: s.prefixText || '',
            suffixText: s.suffixText || ''
          })),
          slotPrompts,
          variableOverrides: config.variableOverrides
        },
        metadata: {
          ...metadata,
          imageIndex: imgIdx,
          totalInCombination: config.countPerCombination
        },
        sortOrder: sortOrder++
      })
    }
  }

  return tasks
}

/**
 * Calculate total task count without generating tasks (for preview)
 */
export function calculateTaskCount(
  moduleSelections: BatchModuleSelection[],
  countPerCombination: number
): { totalCombinations: number; totalTasks: number } {
  let totalCombinations = 1
  let hasDimensions = false

  for (const selection of moduleSelections) {
    if (selection.selectedItemIds.length > 0) {
      totalCombinations *= selection.selectedItemIds.length
      hasDimensions = true
    }
  }

  if (!hasDimensions) return { totalCombinations: 0, totalTasks: 0 }

  return {
    totalCombinations,
    totalTasks: totalCombinations * countPerCombination
  }
}

export type ModuleDataSnapshot = Array<{
  moduleId: string
  moduleType: string
  items: Array<{
    id: string
    name: string
    prompt: string
    negative: string
    weight: number
    enabled: boolean
    prompt_variants?: Record<string, { prompt: string; negative: string }>
  }>
}>

/**
 * Count total tasks from resolved module data (accurate — accounts for enabled items)
 */
export function countTotalTasksFromData(
  config: BatchConfig,
  moduleData: ModuleDataSnapshot
): number {
  const dimensions = buildDimensions(config, moduleData)
  if (dimensions.dimensions.length === 0) return 0

  let totalCombos = 1
  for (const dim of dimensions.dimensions) {
    totalCombos *= dim.length
  }
  return totalCombos * config.countPerCombination
}

/**
 * Generate tasks for a specific index range (lazy expansion).
 * Produces tasks in [startIndex, startIndex + count) without generating all tasks.
 */
export function expandBatchToTasksChunk(
  config: BatchConfig,
  moduleData: ModuleDataSnapshot,
  startIndex: number,
  count: number
): GeneratedTask[] {
  const { dimensions, dimensionModuleIds } = buildDimensions(config, moduleData)
  if (dimensions.length === 0) return []

  const combinations = cartesianProduct(dimensions)
  const totalTasks = combinations.length * config.countPerCombination
  const endIndex = Math.min(startIndex + count, totalTasks)

  const tasks: GeneratedTask[] = []

  for (let taskIdx = startIndex; taskIdx < endIndex; taskIdx++) {
    const comboIdx = Math.floor(taskIdx / config.countPerCombination)
    const imgIdx = taskIdx % config.countPerCombination
    const combo = combinations[comboIdx]

    const task = generateSingleTask(config, combo, dimensionModuleIds, comboIdx, imgIdx, taskIdx)
    tasks.push(task)
  }

  return tasks
}

function buildDimensions(
  config: BatchConfig,
  moduleData: ModuleDataSnapshot
): {
  dimensions: Array<
    Array<{
      moduleType: string
      item: ModuleDataSnapshot[number]['items'][number]
    }>
  >
  dimensionModuleIds: string[]
} {
  const dimensions: Array<
    Array<{
      moduleType: string
      item: ModuleDataSnapshot[number]['items'][number]
    }>
  > = []
  const dimensionModuleIds: string[] = []

  for (const selection of config.moduleSelections) {
    const modData = moduleData.find((m) => m.moduleId === selection.moduleId)
    if (!modData) continue

    const selectedItems = modData.items.filter(
      (item) => selection.selectedItemIds.includes(item.id) && item.enabled
    )

    if (selectedItems.length === 0) continue

    dimensionModuleIds.push(selection.moduleId)
    dimensions.push(
      selectedItems.map((item) => ({
        moduleType: selection.moduleType,
        item
      }))
    )
  }

  return { dimensions, dimensionModuleIds }
}

function generateSingleTask(
  config: BatchConfig,
  combo: Array<{ moduleType: string; item: ModuleDataSnapshot[number]['items'][number] }>,
  dimensionModuleIds: string[],
  comboIdx: number,
  imgIdx: number,
  sortOrder: number
): GeneratedTask {
  // Build modules for prompt composition
  const modules = combo.map((entry) => ({
    type: entry.moduleType,
    items: [
      {
        prompt: entry.item.prompt,
        negative: entry.item.negative,
        weight: entry.item.weight,
        enabled: true
      }
    ]
  }))

  // Extract metadata names
  const metadata: GeneratedTask['metadata'] = {
    combinationIndex: comboIdx,
    imageIndex: imgIdx,
    totalInCombination: config.countPerCombination
  }

  for (const entry of combo) {
    switch (entry.moduleType) {
      case 'character':
        metadata.characterName = entry.item.name
        break
      case 'outfit':
        metadata.outfitName = entry.item.name
        break
      case 'emotion':
        metadata.emotionName = entry.item.name
        break
      case 'style':
        metadata.styleName = entry.item.name
        break
      case 'artist':
        metadata.artistName = entry.item.name
        break
    }
  }

  // Determine seed
  let seed: number
  switch (config.seedMode) {
    case 'fixed':
      seed = config.fixedSeed ?? 42
      break
    case 'incremental':
      seed = (config.fixedSeed ?? 0) + sortOrder
      break
    case 'random':
    default:
      seed = Math.floor(Math.random() * 2147483647)
      break
  }

  const composed = buildPrompt(modules, config.extraVariables as Record<string, string>, seed)

  // Compute per-slot prompts
  const slotPrompts: Record<string, string> = {}
  if (config.slotMappings) {
    for (const slot of config.slotMappings) {
      if (slot.action !== 'inject') continue

      const slotKey = `${slot.nodeId}:${slot.fieldName}`

      if (slot.assignedModuleIds && slot.assignedModuleIds.length > 0) {
        const assignedModules = combo
          .map((entry, idx) => ({ entry, moduleId: dimensionModuleIds[idx] }))
          .filter(({ moduleId }) => slot.assignedModuleIds.includes(moduleId))
          .map(({ entry }) => {
            const variant = slot.promptVariant
              ? entry.item.prompt_variants?.[slot.promptVariant]
              : undefined
            return {
              type: entry.moduleType,
              items: [
                {
                  prompt: variant?.prompt ?? entry.item.prompt,
                  negative: variant?.negative ?? entry.item.negative,
                  weight: entry.item.weight,
                  enabled: true
                }
              ]
            }
          })

        if (assignedModules.length > 0) {
          const slotComposed = buildPrompt(
            assignedModules,
            config.extraVariables as Record<string, string>,
            seed
          )
          const promptText =
            slot.role === 'prompt_positive' ? slotComposed.positive : slotComposed.negative

          const parts: string[] = []
          if (slot.prefixText?.trim()) parts.push(slot.prefixText.trim())
          if (promptText.trim()) parts.push(promptText.trim())
          if (slot.suffixText?.trim()) parts.push(slot.suffixText.trim())
          slotPrompts[slotKey] = parts.join(', ')
        } else {
          const parts: string[] = []
          if (slot.prefixText?.trim()) parts.push(slot.prefixText.trim())
          if (slot.suffixText?.trim()) parts.push(slot.suffixText.trim())
          slotPrompts[slotKey] = parts.join(', ')
        }
      } else {
        const globalPrompt = slot.role === 'prompt_positive' ? composed.positive : composed.negative
        const parts: string[] = []
        if (slot.prefixText?.trim()) parts.push(slot.prefixText.trim())
        if (globalPrompt.trim()) parts.push(globalPrompt.trim())
        if (slot.suffixText?.trim()) parts.push(slot.suffixText.trim())
        slotPrompts[slotKey] = parts.join(', ')
      }
    }
  }

  return {
    promptData: {
      positive: composed.positive,
      negative: composed.negative,
      seed,
      extraVariables: config.extraVariables || {},
      slotMappings: config.slotMappings?.map((s) => ({
        nodeId: s.nodeId,
        fieldName: s.fieldName,
        role: s.role,
        action: s.action,
        fixedValue: s.fixedValue,
        assignedModuleIds: s.assignedModuleIds || [],
        prefixModuleIds: s.prefixModuleIds || [],
        prefixText: s.prefixText || '',
        suffixText: s.suffixText || ''
      })),
      slotPrompts,
      variableOverrides: config.variableOverrides
    },
    metadata,
    sortOrder
  }
}

/**
 * Generate output path from pattern
 */
export function resolveOutputPath(pattern: string, vars: Record<string, string>): string {
  let result = pattern
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), sanitizePathSegment(value))
  }
  return result
}

function sanitizePathSegment(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim()
}
