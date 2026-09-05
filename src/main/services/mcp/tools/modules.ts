import { jsonError, jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo } from './shared'
import { itemQuerySchema, queryModuleItems } from './item-query'

export function registerModuleCoreTools(server: McpServer): void {
  // === Module Management ===

  server.tool(
    'list_modules',
    'List all prompt modules. Optionally filter by type (character, outfit, emotion, style, artist, quality, negative, lora, custom).',
    { type: z.string().optional().describe('Module type filter') },
    async ({ type }) => {
      const modules = moduleRepo.list(type)
      return jsonResult(modules)
    }
  )

  server.tool(
    'get_module',
    'Get module metadata and a bounded page of items. Use limit/offset to inspect additional items.',
    {
      id: z.string().describe('Module ID'),
      limit: itemQuerySchema.limit,
      offset: itemQuerySchema.offset
    },
    async ({ id, limit, offset }) => {
      const mod = moduleRepo.get(id)
      if (!mod) {
        return {
          content: [{ type: 'text', text: `Module not found: ${id}` }],
          isError: true
        }
      }
      return jsonResult({ module: mod, ...queryModuleItems(id, { limit, offset }) })
    }
  )

  server.tool(
    'create_module',
    'Create a new prompt module.',
    {
      name: z.string().describe('Module name'),
      type: z
        .enum([
          'character',
          'outfit',
          'emotion',
          'style',
          'artist',
          'quality',
          'negative',
          'lora',
          'custom'
        ])
        .describe('Module type'),
      description: z.string().optional().describe('Module description')
    },
    async ({ name, type, description }) => {
      const id = moduleRepo.create({ name, type, description })
      return jsonResult({ id, name, type })
    }
  )

  server.tool(
    'update_module',
    'Update an existing prompt module.',
    {
      id: z.string().describe('Module ID'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description')
    },
    async ({ id, name, description }) => {
      if (!moduleRepo.get(id)) return jsonError(`Module not found: ${id}`)
      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
      if (Object.keys(data).length === 0) return jsonError('Provide at least one field to update')
      moduleRepo.update(id, data)
      return jsonResult({ success: true, id })
    }
  )

  server.tool(
    'delete_module',
    'Delete a prompt module and all its items.',
    { id: z.string().describe('Module ID') },
    async ({ id }) => {
      moduleRepo.delete(id)
      return jsonResult({ success: true, id })
    }
  )
}
