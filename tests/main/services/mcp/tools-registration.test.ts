import { describe, expect, it } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerMcpTools } from '@main/services/mcp/tools'

const EXPECTED_TOOL_NAMES = [
  'list_modules',
  'get_module',
  'create_module',
  'update_module',
  'delete_module',
  'list_module_items',
  'create_module_item',
  'update_module_item',
  'delete_module_item',
  'get_module_item',
  'bulk_update_module_items',
  'replace_tag_in_module',
  'validate_module_tags',
  'search_module_items',
  'bulk_create_module_items',
  'import_module_items_from_file',
  'duplicate_module',
  'get_module_stats',
  'export_module_items_to_file',
  'diff_module_with_file',
  'sync_module_from_file',
  'list_workflows',
  'get_workflow',
  'create_batch_job',
  'start_batch_job',
  'list_batch_jobs',
  'get_batch_job',
  'validate_danbooru_tags',
  'search_danbooru_tags',
  'get_popular_danbooru_tags'
] as const

describe('MCP tool registration contract', () => {
  it('registers the stable tool and prompt surface in order', () => {
    const tools: Array<{ name: string; description: string; inputKeys: string[] }> = []
    const prompts: Array<{ name: string; description: string; inputKeys: string[] }> = []
    const server = {
      tool: (...args: unknown[]) => {
        const [name, description, schema] = args as [
          string,
          string,
          Record<string, unknown> | undefined
        ]
        tools.push({ name, description, inputKeys: Object.keys(schema ?? {}) })
      },
      prompt: (...args: unknown[]) => {
        const [name, description, schema] = args as [
          string,
          string,
          Record<string, unknown> | undefined
        ]
        prompts.push({ name, description, inputKeys: Object.keys(schema ?? {}) })
      }
    } as unknown as McpServer

    registerMcpTools(server)

    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES)
    expect(tools).toHaveLength(30)
    expect(tools.every((tool) => tool.description.length > 0)).toBe(true)
    expect(prompts).toEqual([
      {
        name: 'danbooru_tag_guide',
        description:
          'Guidelines and reference for writing image generation prompts using Danbooru tags. Call this before creating character prompts to get the correct tag format and popular tags.',
        inputKeys: ['character_description']
      }
    ])
  })
})
