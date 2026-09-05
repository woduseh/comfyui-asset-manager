import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ connected: true, getObjectInfo: vi.fn() }))
vi.mock('../../../../src/main/services/comfyui/manager', () => ({
  comfyuiManager: {
    get isConnected(): boolean {
      return mocks.connected
    },
    restClient: { getObjectInfo: mocks.getObjectInfo }
  }
}))

import { registerComfyUICatalogTools } from '../../../../src/main/services/mcp/tools/comfyui-catalog'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
let tool: { schema: z.ZodObject<z.ZodRawShape>; handler: Handler }
registerComfyUICatalogTools({
  tool: (_name: string, _description: string, schema: z.ZodRawShape, handler: Handler) => {
    tool = { schema: z.object(schema), handler }
  }
} as unknown as McpServer)

async function call(args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return tool.handler(tool.schema.parse(args))
}

function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: { required: {} },
    output: [],
    display_name: 'Display',
    category: 'test',
    description: 'Untrusted description',
    ...overrides
  }
}

beforeEach(() => {
  mocks.connected = true
  mocks.getObjectInfo.mockReset().mockResolvedValue({
    CheckpointLoaderSimple: node({
      category: 'loaders',
      display_name: 'Load Checkpoint',
      input: {
        required: { ckpt_name: [['first.safetensors', 'second.safetensors', 'third.ckpt']] }
      },
      output: ['MODEL', 'CLIP', 'VAE'],
      output_name: ['MODEL', 'CLIP', 'VAE']
    }),
    KSampler: node({
      input: {
        required: {
          seed: ['INT', { default: 1, min: 0, max: 100, step: 1 }],
          sampler_name: [['euler', 'dpmpp_2m', 'euler_ancestral']]
        },
        optional: { active: ['BOOLEAN', { default: false }] }
      }
    }),
    SaveImage: node({ output_node: true })
  })
})

describe('MCP live ComfyUI capability catalog', () => {
  it('returns bounded sorted summaries without input enums or raw catalog payloads', async () => {
    const result = await call({ limit: 2 })
    expect(mocks.getObjectInfo).toHaveBeenCalledOnce()
    expect(result.structuredContent).toMatchObject({
      source: 'Connected ComfyUI GET /object_info',
      server_data_is_untrusted: true,
      mode: 'catalog',
      total: 3,
      limit: 2,
      has_more: true,
      next_offset: 2
    })
    const nodes = result.structuredContent!.nodes as Record<string, unknown>[]
    expect(nodes.map((item) => item.node_type)).toEqual(['CheckpointLoaderSimple', 'KSampler'])
    expect(nodes[0]).not.toHaveProperty('input')
    expect(nodes[0]).not.toHaveProperty('description')
    const next = await call({ offset: 2, limit: 2 })
    expect(next.structuredContent).toMatchObject({
      has_more: false,
      next_offset: null,
      nodes: [{ node_type: 'SaveImage', output_node: true }]
    })
  })

  it.each(['checkpoint', 'Load Checkpoint', 'LOADERS'])(
    'matches node type, display name and category: %s',
    async (query) => {
      const result = await call({ query })
      expect(result.structuredContent).toMatchObject({
        total: 1,
        nodes: [{ node_type: 'CheckpointLoaderSimple' }]
      })
    }
  )

  it('exposes actual models, required/optional fields, constraints and outputs in details', async () => {
    const result = await call({ node_types: ['CheckpointLoaderSimple', 'KSampler'], enum_limit: 2 })
    const nodes = result.structuredContent!.nodes as Array<Record<string, unknown>>
    expect(nodes[0]).toMatchObject({
      inputs: [
        {
          name: 'ckpt_name',
          required: true,
          type: 'COMBO',
          enum: {
            values: ['first.safetensors', 'second.safetensors'],
            total: 3,
            has_more: true,
            next_offset: 2
          }
        }
      ],
      outputs: [
        { index: 0, type: 'MODEL' },
        { index: 1, type: 'CLIP' },
        { index: 2, type: 'VAE' }
      ]
    })
    expect(nodes[1].inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'active',
          required: false,
          type: 'BOOLEAN',
          options: { default: false }
        }),
        expect.objectContaining({
          name: 'seed',
          required: true,
          type: 'INT',
          options: { default: 1, min: 0, max: 100, step: 1 }
        })
      ])
    )
  })

  it('paginates and searches actual enum values independently of input field selection', async () => {
    const result = await call({
      node_types: ['KSampler'],
      field_names: ['sampler_name'],
      enum_query: 'EULER',
      enum_offset: 1,
      enum_limit: 1
    })
    expect(result.structuredContent).toMatchObject({
      nodes: [
        {
          input_total: 1,
          inputs: [
            {
              name: 'sampler_name',
              enum: {
                values: ['euler_ancestral'],
                total: 2,
                total_available: 3,
                offset: 1,
                has_more: false
              }
            }
          ]
        }
      ]
    })
  })

  it('paginates input fields and identifies missing selections', async () => {
    const result = await call({ node_types: ['KSampler'], input_limit: 1, input_offset: 1 })
    expect(result.structuredContent).toMatchObject({
      nodes: [
        {
          input_total: 3,
          inputs_have_more: true,
          next_input_offset: 2,
          inputs: [{ name: 'sampler_name' }]
        }
      ]
    })
    const selected = await call({ node_types: ['KSampler'], field_names: ['missing'] })
    expect(selected.structuredContent).toMatchObject({
      nodes: [{ input_total: 0, inputs: [], missing_fields: ['missing'] }]
    })
  })

  it('reports unavailable exact node types without treating inherited properties as nodes', async () => {
    const result = await call({ node_types: ['Absent', 'toString', 'KSampler', 'KSampler'] })
    expect(result.structuredContent).toMatchObject({ missing_node_types: ['Absent', 'toString'] })
    expect(result.structuredContent!.nodes).toHaveLength(1)
  })

  it('avoids network calls while disconnected', async () => {
    mocks.connected = false
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('connect_comfyui')
    expect(mocks.getObjectInfo).not.toHaveBeenCalled()
  })

  it('reports transport failures and malformed catalog responses', async () => {
    mocks.getObjectInfo.mockRejectedValueOnce(new Error('timeout'))
    const failure = await call()
    expect(failure.isError).toBe(true)
    expect(failure.structuredContent!.error).toContain('timeout')
    mocks.getObjectInfo.mockResolvedValueOnce([])
    expect((await call()).isError).toBe(true)
  })

  it('reports malformed nodes and unsupported input shapes without returning arbitrary objects', async () => {
    mocks.getObjectInfo.mockResolvedValueOnce({
      Broken: null,
      Custom: node({
        input: {
          required: {
            bad: 'schema',
            options: [[{ untrusted: 'object' }, 'valid']],
            tooltip: ['STRING', { tooltip: 'x'.repeat(2000) }]
          }
        }
      })
    })
    const result = await call({ node_types: ['Broken', 'Custom'] })
    expect(result.structuredContent!.malformed_node_types).toEqual(['Broken'])
    const custom = (result.structuredContent!.nodes as Array<Record<string, unknown>>)[0]
    expect(custom.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'bad', supported: false }),
        expect.objectContaining({
          name: 'options',
          enum: expect.objectContaining({ values: ['valid'], unsupported_values: 1 })
        }),
        expect.objectContaining({ name: 'tooltip', options: { tooltip: 'x'.repeat(1000) } })
      ])
    )
  })

  it.each([
    { limit: 101 },
    { offset: -1 },
    { enum_limit: 101 },
    { input_limit: 0 },
    { node_types: Array(11).fill('KSampler') }
  ])('rejects unbounded or invalid schema inputs: %j', async (args) => {
    await expect(call(args)).rejects.toThrow()
    expect(mocks.getObjectInfo).not.toHaveBeenCalled()
  })
})
