import { z } from 'zod'
import { moduleItemRepo } from './shared'
import { validatePromptVariants } from '../../../ipc/validators'
import { MAX_LIST_ITEMS_LIMIT } from '../../../constants'

export const itemQuerySchema = {
  query: z.string().optional().describe('Case-insensitive substring search; omit to list items'),
  field: z
    .enum(['prompt', 'negative', 'name', 'all'])
    .optional()
    .describe('Search field (default: all)'),
  include_variants: z.boolean().optional().describe('Search variants too (default: true)'),
  variant_names: z
    .array(z.string())
    .optional()
    .describe('Restrict searched variants to these names'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_ITEMS_LIMIT)
    .optional()
    .describe('Page size (default: 50, max: 200)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of matching items to skip (default: 0)')
}

export function itemDto(item: Record<string, unknown>): Record<string, unknown> {
  return { ...item, prompt_variants: validatePromptVariants(item.prompt_variants) }
}

export function queryModuleItems(
  moduleId: string,
  options: {
    query?: string
    field?: 'prompt' | 'negative' | 'name' | 'all'
    include_variants?: boolean
    variant_names?: string[]
    limit?: number
    offset?: number
  }
): {
  items: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
  has_more: boolean
} {
  const limit = Math.min(options.limit ?? 50, MAX_LIST_ITEMS_LIMIT)
  const offset = options.offset ?? 0
  if (options.query === undefined) {
    const total = moduleItemRepo.count(moduleId)
    const items = moduleItemRepo.list(moduleId, { limit, offset }).map(itemDto)
    return { items, total, limit, offset, has_more: offset + items.length < total }
  }
  const query = options.query.toLowerCase()
  const field = options.field ?? 'all'
  const matches: Record<string, unknown>[] = []
  let total = 0
  // Scan bounded pages so a large module does not require a full copy in memory.
  for (let scanOffset = 0; ; scanOffset += MAX_LIST_ITEMS_LIMIT) {
    const page = moduleItemRepo.list(moduleId, { limit: MAX_LIST_ITEMS_LIMIT, offset: scanOffset })
    for (const raw of page) {
      const item = itemDto(raw)
      const matchedFields: string[] = []
      for (const key of ['name', 'prompt', 'negative']) {
        if (
          (field === 'all' || field === key) &&
          String(item[key] ?? '')
            .toLowerCase()
            .includes(query)
        )
          matchedFields.push(key)
      }
      if (options.include_variants !== false && field !== 'name') {
        for (const [name, variant] of Object.entries(validatePromptVariants(raw.prompt_variants))) {
          if (options.variant_names && !options.variant_names.includes(name)) continue
          for (const key of ['prompt', 'negative'] as const) {
            if ((field === 'all' || field === key) && variant[key].toLowerCase().includes(query))
              matchedFields.push(`variant:${name}:${key}`)
          }
        }
      }
      if (matchedFields.length > 0) {
        if (total >= offset && matches.length < limit)
          matches.push({ ...item, matched_fields: matchedFields })
        total++
      }
    }
    if (page.length < MAX_LIST_ITEMS_LIMIT) break
  }
  return { items: matches, total, limit, offset, has_more: offset + matches.length < total }
}
