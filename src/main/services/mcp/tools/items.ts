import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleItemRepo } from './shared'
import { validatePromptVariants } from '../../../ipc/validators'
import { MAX_LIST_ITEMS_LIMIT } from '../../../constants'

export function registerItemCoreTools(server: McpServer): void {
  // === Module Item Management ===

  server.tool(
    'list_module_items',
    'List all items in a prompt module. Supports pagination with limit/offset for large modules.',
    {
      module_id: z.string().describe('Module ID'),
      limit: z
        .number()
        .optional()
        .describe(`Max items to return (default: all, max: ${MAX_LIST_ITEMS_LIMIT})`),
      offset: z.number().optional().describe('Number of items to skip (default: 0)')
    },
    async ({ module_id, limit, offset }) => {
      const total = moduleItemRepo.count(module_id)
      const effectiveLimit = limit !== undefined ? Math.min(limit, MAX_LIST_ITEMS_LIMIT) : undefined
      const options =
        effectiveLimit !== undefined ? { limit: effectiveLimit, offset: offset ?? 0 } : undefined
      const items = moduleItemRepo.list(module_id, options)
      const response: Record<string, unknown> = { items, total }
      if (options) {
        response.limit = effectiveLimit
        response.offset = options.offset
        response.has_more = options.offset + items.length < total
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
      }
    }
  )

  server.tool(
    'create_module_item',
    'Create a new item in a prompt module. Supports optional prompt variants for per-slot different prompts.',
    {
      module_id: z.string().describe('Module ID'),
      name: z.string().describe('Item name'),
      prompt: z.string().describe('Positive prompt text (default)'),
      negative: z.string().optional().describe('Negative prompt text (default)'),
      weight: z.number().optional().describe('Weight (default: 1.0)'),
      prompt_variants: z
        .record(
          z.string(),
          z.object({
            prompt: z.string().describe('Variant positive prompt'),
            negative: z.string().describe('Variant negative prompt')
          })
        )
        .optional()
        .describe(
          'Named prompt variants, e.g. {"natural_language": {prompt: "...", negative: "..."}, "tags": {prompt: "...", negative: "..."}}'
        )
    },
    async ({ module_id, name, prompt, negative, weight, prompt_variants }) => {
      const id = moduleItemRepo.create({
        module_id,
        name,
        prompt,
        negative: negative || '',
        weight: weight ?? 1.0,
        prompt_variants: prompt_variants ? JSON.stringify(prompt_variants) : '{}'
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ id, name, module_id }) }]
      }
    }
  )

  server.tool(
    'update_module_item',
    'Update an existing module item. Supports prompt variants for per-slot different prompts.',
    {
      id: z.string().describe('Item ID'),
      name: z.string().optional().describe('New name'),
      prompt: z.string().optional().describe('New default prompt text'),
      negative: z.string().optional().describe('New default negative prompt'),
      weight: z.number().optional().describe('New weight'),
      prompt_variants: z
        .record(
          z.string(),
          z.object({
            prompt: z.string().describe('Variant positive prompt'),
            negative: z.string().describe('Variant negative prompt')
          })
        )
        .optional()
        .describe('Named prompt variants (replaces all existing variants)')
    },
    async ({ id, name, prompt, negative, weight, prompt_variants }) => {
      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (prompt !== undefined) data.prompt = prompt
      if (negative !== undefined) data.negative = negative
      if (weight !== undefined) data.weight = weight
      if (prompt_variants !== undefined) data.prompt_variants = JSON.stringify(prompt_variants)
      moduleItemRepo.update(id, data)
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }]
      }
    }
  )

  server.tool(
    'delete_module_item',
    'Delete a module item.',
    { id: z.string().describe('Item ID') },
    async ({ id }) => {
      moduleItemRepo.delete(id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }]
      }
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
      if (typeof item.prompt_variants === 'string') {
        item.prompt_variants = validatePromptVariants(item.prompt_variants)
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(item, null, 2) }]
      }
    }
  )
}
