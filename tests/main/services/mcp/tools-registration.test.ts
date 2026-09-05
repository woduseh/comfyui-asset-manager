import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerMcpTools } from '@main/services/mcp/tools'
import { MCP_SERVER_INSTRUCTIONS } from '@main/services/mcp/tools/guide'

const EXPECTED_TOOL_NAMES = [
  'list_modules',
  'get_module',
  'create_module',
  'update_module',
  'delete_module',
  'list_module_items',
  'delete_module_item',
  'get_module_item',
  'update_module_items',
  'replace_tag_in_module',
  'validate_module_tags',
  'create_module_items',
  'import_module_items_from_file',
  'duplicate_module',
  'get_module_stats',
  'export_module_items_to_file',
  'diff_module_with_file',
  'sync_module_from_file',
  'list_workflows',
  'get_workflow',
  'preview_batch_job',
  'create_batch_job',
  'update_batch_job',
  'start_batch_job',
  'list_batch_jobs',
  'get_batch_job',
  'list_batch_tasks',
  'validate_danbooru_tags',
  'search_danbooru_tags',
  'get_popular_danbooru_tags',
  'list_generated_images',
  'get_generated_image',
  'review_generated_image',
  'get_execution_status',
  'connect_comfyui',
  'control_batch_job',
  'wait_batch_job',
  'inspect_comfyui',
  'prepare_workflow',
  'get_generation_guide'
] as const

describe('MCP tool registration contract', () => {
  it('exposes every schema and the generation guide through the actual SDK protocol', async () => {
    const server = new McpServer(
      { name: 'generation-test', version: '1.0.0' },
      { instructions: MCP_SERVER_INSTRUCTIONS }
    )
    registerMcpTools(server)
    const client = new Client({ name: 'agent-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES)
      expect(
        listed.tools.every((tool) => tool.inputSchema.type === 'object' && tool.annotations)
      ).toBe(true)
      expect(listed.tools.every((tool) => tool.description && tool.description.length > 0)).toBe(
        true
      )
      const prompts = await client.listPrompts()
      expect(
        prompts.prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          inputKeys: prompt.arguments?.map((argument) => argument.name)
        }))
      ).toEqual([
        {
          name: 'danbooru_tag_guide',
          description: expect.stringContaining('Danbooru'),
          inputKeys: ['character_description']
        }
      ])
      expect(client.getInstructions()).toContain('get_generation_guide')
      const guide = await client.callTool({ name: 'get_generation_guide', arguments: {} })
      expect(guide.isError).not.toBe(true)
      expect(JSON.stringify(guide.structuredContent)).toContain('get_generated_image')
      const guideSteps = (guide.structuredContent as { steps: Array<{ tools: string[] }> }).steps
      const names = new Set(listed.tools.map((tool) => tool.name))
      for (const step of guideSteps) {
        for (const name of step.tools) expect(names.has(name), `Guide tool ${name}`).toBe(true)
      }
      expect(
        listed.tools.find((tool) => tool.name === 'inspect_comfyui')?.annotations
      ).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false
      })
      expect(
        listed.tools.find((tool) => tool.name === 'prepare_workflow')?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: false
      })
      const invalidRecipe = await client.callTool({
        name: 'prepare_workflow',
        arguments: {
          name: 'Invalid dimensions',
          source: { kind: 'checkpoint_text_to_image', width: 65 }
        }
      })
      expect(invalidRecipe.isError).toBe(true)
      const invalid = await client.callTool({
        name: 'list_batch_tasks',
        arguments: { job_id: 'job', limit: -1 }
      })
      expect(invalid.isError).toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
