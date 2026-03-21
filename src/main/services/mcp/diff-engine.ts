import { extractTagsFromPrompt } from '../tags/utils'
import type { ParsedModuleItem } from './file-parser'

export interface DiffItem {
  name: string
  prompt: string
  negative?: string
  prompt_variants?: Record<string, { prompt: string; negative: string }>
}

export interface ModifiedEntry {
  name: string
  module_item_id?: string
  prompt_diff: {
    added_tags: string[]
    removed_tags: string[]
    from: string
    to: string
  }
  negative_diff?: {
    from: string
    to: string
  }
  variants_changed: boolean
}

export interface DiffResult {
  added: ParsedModuleItem[]
  removed: DiffItem[]
  modified: ModifiedEntry[]
  unchanged_count: number
  summary: {
    total_in_module: number
    total_in_file: number
    added: number
    removed: number
    modified: number
    unchanged: number
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/** Compare module items (from DB) with parsed items (from file) */
export function diffModuleWithItems(
  moduleItems: Array<DiffItem & { id?: string }>,
  fileItems: ParsedModuleItem[]
): DiffResult {
  const moduleMap = new Map<string, DiffItem & { id?: string }>()
  for (const item of moduleItems) {
    moduleMap.set(normalizeName(item.name), item)
  }

  const fileMap = new Map<string, ParsedModuleItem>()
  for (const item of fileItems) {
    fileMap.set(normalizeName(item.name), item)
  }

  const added: ParsedModuleItem[] = []
  const removed: DiffItem[] = []
  const modified: ModifiedEntry[] = []
  let unchangedCount = 0

  // Check file items against module
  for (const [normalizedName, fileItem] of fileMap) {
    const moduleItem = moduleMap.get(normalizedName)
    if (!moduleItem) {
      added.push(fileItem)
      continue
    }

    // Compare prompts
    const modulePrompt = moduleItem.prompt.trim()
    const filePrompt = fileItem.prompt.trim()
    const moduleNeg = (moduleItem.negative || '').trim()
    const fileNeg = (fileItem.negative || '').trim()

    const promptChanged = modulePrompt !== filePrompt
    const negativeChanged = moduleNeg !== fileNeg

    // Compare variants
    const moduleVariants = moduleItem.prompt_variants || {}
    const fileVariants = fileItem.prompt_variants || {}
    const variantsChanged = JSON.stringify(moduleVariants) !== JSON.stringify(fileVariants)

    if (!promptChanged && !negativeChanged && !variantsChanged) {
      unchangedCount++
      continue
    }

    // Compute tag-level diff for prompt
    const moduleTags = extractTagsFromPrompt(modulePrompt)
    const fileTags = extractTagsFromPrompt(filePrompt)
    const moduleTagSet = new Set(moduleTags.map((t) => t.toLowerCase()))
    const fileTagSet = new Set(fileTags.map((t) => t.toLowerCase()))

    const addedTags = fileTags.filter((t) => !moduleTagSet.has(t.toLowerCase()))
    const removedTags = moduleTags.filter((t) => !fileTagSet.has(t.toLowerCase()))

    const entry: ModifiedEntry = {
      name: fileItem.name,
      module_item_id: moduleItem.id,
      prompt_diff: {
        added_tags: addedTags,
        removed_tags: removedTags,
        from: modulePrompt,
        to: filePrompt
      },
      variants_changed: variantsChanged
    }

    if (negativeChanged) {
      entry.negative_diff = { from: moduleNeg, to: fileNeg }
    }

    modified.push(entry)
  }

  // Items in module but not in file → removed
  for (const [normalizedName, moduleItem] of moduleMap) {
    if (!fileMap.has(normalizedName)) {
      removed.push(moduleItem)
    }
  }

  return {
    added,
    removed,
    modified,
    unchanged_count: unchangedCount,
    summary: {
      total_in_module: moduleItems.length,
      total_in_file: fileItems.length,
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged: unchangedCount
    }
  }
}
