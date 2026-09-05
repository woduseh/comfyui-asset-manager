import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation'
import { registerMcpTools } from '@main/services/mcp/tools'
import { MCP_SERVER_INSTRUCTIONS } from '@main/services/mcp/tools/guide'
import { tagService } from '@main/services/tags'

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

async function withMcpClient(run: (client: Client) => Promise<void>): Promise<void> {
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
    await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}

afterEach(() => vi.restoreAllMocks())

describe('MCP tool registration contract', () => {
  it('exposes every schema and prompt through the actual SDK protocol', async () => {
    await withMcpClient(async (client) => {
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
    })
  })

  it('returns an overview by default and serves only the requested guide topic', async () => {
    await withMcpClient(async (client) => {
      const listed = await client.listTools()
      const guideTool = listed.tools.find((tool) => tool.name === 'get_generation_guide')!
      expect(guideTool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
      expect(guideTool.inputSchema.required ?? []).not.toContain('topic')
      const schema = guideTool.inputSchema.properties!.topic as { enum: string[] }
      const overview = await client.callTool({ name: 'get_generation_guide', arguments: {} })
      expect(overview.isError).not.toBe(true)
      expect(overview.structuredContent).toMatchObject({
        topic: 'overview',
        contract: expect.any(String)
      })
      expect(overview.structuredContent).not.toHaveProperty('steps')
      expect(overview.structuredContent).not.toHaveProperty('example')
      const explicitOverview = await client.callTool({
        name: 'get_generation_guide',
        arguments: { topic: 'overview' }
      })
      expect(explicitOverview.structuredContent).toEqual(overview.structuredContent)

      const overviewData = overview.structuredContent as {
        contract: string
        topics: Array<{ topic: string; when: string }>
      }
      const routes = overviewData.topics
      expect(routes.map(({ topic }) => topic).sort()).toEqual(
        schema.enum.filter((topic) => topic !== 'overview').sort()
      )
      const toolNames = new Set(listed.tools.map((tool) => tool.name))
      const validator = new AjvJsonSchemaValidator()
      for (const route of routes) {
        expect(Object.keys(route).sort()).toEqual(['topic', 'when'])
        const result = await client.callTool({
          name: 'get_generation_guide',
          arguments: { topic: route.topic }
        })
        expect(result.isError).not.toBe(true)
        expect(result.structuredContent).toMatchObject({
          topic: route.topic,
          when: route.when,
          contract: overviewData.contract
        })
        expect(result.structuredContent).not.toHaveProperty('topics')
        const steps = (result.structuredContent as { steps: Array<{ tools: string[] }> }).steps
        expect(steps.length).toBeGreaterThan(0)
        for (const step of steps) {
          for (const name of step.tools)
            expect(toolNames.has(name), `Guide tool ${name}`).toBe(true)
        }
        const example = (result.structuredContent as { example?: Record<string, unknown> }).example
        for (const [name, args] of Object.entries(example ?? {})) {
          const tool = listed.tools.find((tool) => tool.name === name)
          if (!tool) continue
          const validation = validator.getValidator(tool.inputSchema as JsonSchemaType)(args)
          expect(validation.valid, `${route.topic}/${name}: ${validation.errorMessage}`).toBe(true)
        }
      }

      for (const topic of ['unknown-topic', ['workflow'], null]) {
        const result = await client.callTool({ name: 'get_generation_guide', arguments: { topic } })
        expect(result.isError).toBe(true)
      }
    })
  })

  it('serves the tag prompt without loading a catalogue and preserves supplied reference text', async () => {
    vi.spyOn(tagService, 'isLoaded').mockReturnValue(true)
    const catalogue = vi.spyOn(tagService, 'getPopularGrouped').mockImplementation(() => {
      throw new Error('Reading prompt guidance must not query the tag catalogue')
    })
    await withMcpClient(async (client) => {
      const withoutReference = await client.getPrompt({ name: 'danbooru_tag_guide', arguments: {} })
      const reference = 'Silver hair\n"Blue eyes" and a backslash: \\'
      const withReference = await client.getPrompt({
        name: 'danbooru_tag_guide',
        arguments: { character_description: reference }
      })
      expect(withoutReference.messages).toHaveLength(1)
      expect(withReference.messages).toHaveLength(1)
      const base = withoutReference.messages[0].content
      const contextual = withReference.messages[0].content
      expect(base.type).toBe('text')
      expect(contextual.type).toBe('text')
      if (base.type !== 'text' || contextual.type !== 'text')
        throw new Error('Expected text prompts')
      expect(contextual.text.startsWith(base.text)).toBe(true)
      const encodedReference = contextual.text.trimEnd().split('\n').at(-1)!
      expect(JSON.parse(encodedReference)).toBe(reference)
      expect(catalogue).not.toHaveBeenCalled()
    })
  })
})
