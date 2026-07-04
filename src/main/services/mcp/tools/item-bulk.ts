import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'
import { MAX_BULK_UPDATE_ITEMS } from '../../../constants'

export function registerItemBulkTools(server: McpServer): void {
  // === Bulk Create ===

  server.tool(
    'bulk_create_module_items',
    `Create multiple module items at once (max ${MAX_BULK_UPDATE_ITEMS}). Returns created IDs and error details.`,
    {
      module_id: z.string().describe('Module ID'),
      items: z
        .array(
          z.object({
            name: z.string().describe('Item name'),
            prompt: z.string().describe('Positive prompt text'),
            negative: z.string().optional().describe('Negative prompt text'),
            weight: z.number().optional().describe('Weight (default: 1.0)'),
            prompt_variants: z
              .record(
                z.string(),
                z.object({
                  prompt: z.string(),
                  negative: z.string()
                })
              )
              .optional()
              .describe('Named prompt variants')
          })
        )
        .describe('Array of items to create')
    },
    async ({ module_id, items }) => {
      if (items.length > MAX_BULK_UPDATE_ITEMS) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Too many items: ${items.length}. Maximum: ${MAX_BULK_UPDATE_ITEMS}`
              })
            }
          ],
          isError: true
        }
      }

      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Module not found' }) }],
          isError: true
        }
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: items.length,
                succeeded: result.succeeded,
                failed: result.failed,
                ids: result.ids,
                errors: result.errors
              },
              null,
              2
            )
          }
        ]
      }
    }
  )
}
