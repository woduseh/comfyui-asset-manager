import { jsonError, jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'
import { itemDto, itemQuerySchema, queryModuleItems } from './item-query'

export function registerItemCoreTools(server: McpServer): void {
  // === Module Item Management ===

  server.tool(
    'list_module_items',
    'List or search items in a prompt module with bounded pagination. Prompt variants are returned as objects. Use offset and has_more to read additional pages.',
    { module_id: z.string().describe('Module ID'), ...itemQuerySchema },
    async ({ module_id, ...options }) => {
      if (!moduleRepo.get(module_id)) return jsonError(`Module not found: ${module_id}`)
      return jsonResult(queryModuleItems(module_id, options))
    }
  )

  server.tool(
    'delete_module_item',
    'Delete a module item.',
    { id: z.string().describe('Item ID') },
    async ({ id }) => {
      moduleItemRepo.delete(id)
      return jsonResult({ success: true, id })
    }
  )

  server.tool(
    'get_module_item',
    'Get a specific module item by ID, including its prompt variants.',
    { id: z.string().describe('Item ID') },
    async ({ id }) => {
      const item = moduleItemRepo.get(id)
      if (!item) {
        return {
          content: [{ type: 'text', text: `Module item not found: ${id}` }],
          isError: true
        }
      }
      return jsonResult(itemDto(item))
    }
  )
}
