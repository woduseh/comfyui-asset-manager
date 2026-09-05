import { jsonError, jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'
import { MAX_BULK_UPDATE_ITEMS } from '../../../constants'

export function registerItemBulkTools(server: McpServer): void {
  // === Bulk Create ===

  server.tool(
    'create_module_items',
    `Create one or more module items in a module; pass an array of one for a single item (max ${MAX_BULK_UPDATE_ITEMS}). Returns succeeded/failed counts, created IDs, and per-index errors. Partial success is possible; retry only failed entries to avoid duplicates. After a lost response, inspect list_module_items before retrying.`,
    {
      module_id: z.string().min(1).describe('Module ID'),
      items: z
        .array(
          z.object({
            name: z.string().trim().min(1).describe('Item name'),
            prompt: z
              .string()
              .describe(
                'Composed text: positive for ordinary modules, exclusions for negative-type modules'
              ),
            negative: z
              .string()
              .optional()
              .describe(
                'Stored auxiliary field; batch composition does not use it. Put exclusions in the prompt of a negative-type module item.'
              ),
            weight: z.number().finite().optional().describe('Weight (default: 1.0)'),
            prompt_variants: z
              .record(
                z.string(),
                z.object({
                  prompt: z.string(),
                  negative: z
                    .string()
                    .describe(
                      'Auxiliary field, not composed. For a negative-type module put exclusions in variant.prompt.'
                    )
                })
              )
              .optional()
              .describe('Named prompt variants')
          })
        )
        .min(1)
        .max(MAX_BULK_UPDATE_ITEMS)
        .describe('Array of items to create')
    },
    async ({ module_id, items }) => {
      if (items.length > MAX_BULK_UPDATE_ITEMS) {
        return jsonError(`Too many items: ${items.length}. Maximum: ${MAX_BULK_UPDATE_ITEMS}`)
      }

      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return jsonError('Module not found')
      }

      const preparedItems = items.map((item, index) => ({
        module_id,
        name: item.name,
        prompt: item.prompt,
        negative: item.negative,
        weight: item.weight,
        sort_order: index,
        prompt_variants: item.prompt_variants ? JSON.stringify(item.prompt_variants) : undefined
      }))

      const result = moduleItemRepo.bulkCreate(preparedItems)

      return jsonResult({
        total: items.length,
        succeeded: result.succeeded,
        failed: result.failed,
        ids: result.ids,
        errors: result.errors
      })
    }
  )
}
