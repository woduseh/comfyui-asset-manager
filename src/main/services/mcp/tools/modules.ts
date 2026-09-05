import { jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'

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
    'Get a specific prompt module by ID, including its items.',
    { id: z.string().describe('Module ID') },
    async ({ id }) => {
      const mod = moduleRepo.get(id)
      if (!mod) {
        return {
          content: [{ type: 'text', text: `Module not found: ${id}` }],
          isError: true
        }
      }
      const items = moduleItemRepo.list(id)
      return jsonResult({ module: mod, items })
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
      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
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
