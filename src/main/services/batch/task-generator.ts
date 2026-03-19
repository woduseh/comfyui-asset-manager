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
    }>
  }>
): GeneratedTask[] {
  // Build the cartesian dimensions
  const dimensions: Array<Array<{
    moduleType: string
    item: { id: string; name: string; prompt: string; negative: string; weight: number; enabled: boolean }
  }>> = []

  for (const selection of config.moduleSelections) {
    const modData = moduleData.find((m) => m.moduleId === selection.moduleId)
    if (!modData) continue

    const selectedItems = modData.items.filter(
      (item) => selection.selectedItemIds.includes(item.id) && item.enabled
    )

    if (selectedItems.length === 0) continue

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

      tasks.push({
        promptData: {
          positive: composed.positive,
          negative: composed.negative,
          seed,
          extraVariables: config.extraVariables || {}
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

/**
 * Generate output path from pattern
 */
export function resolveOutputPath(
  pattern: string,
  vars: Record<string, string>
): string {
  let result = pattern
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), sanitizePathSegment(value))
  }
  return result
}

function sanitizePathSegment(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim()
}
