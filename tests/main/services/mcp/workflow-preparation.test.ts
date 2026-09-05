import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { MAX_WORKFLOW_FILE_SIZE_BYTES } from '../../../../src/main/constants'

const mocks = vi.hoisted(() => ({
  create: vi.fn(() => 'workflow-new'),
  setVariables: vi.fn(),
  get: vi.fn(),
  getVariables: vi.fn(),
  getObjectInfo: vi.fn(),
  connected: true,
  transaction: vi.fn((operation: () => unknown) => operation())
}))
vi.mock('../../../../src/main/services/mcp/tools/shared', () => ({
  workflowRepo: {
    create: mocks.create,
    setVariables: mocks.setVariables,
    get: mocks.get,
    getVariables: mocks.getVariables
  }
}))
vi.mock('../../../../src/main/services/database', () => ({ withTransaction: mocks.transaction }))
vi.mock('../../../../src/main/services/comfyui/manager', () => ({
  comfyuiManager: {
    get isConnected(): boolean {
      return mocks.connected
    },
    restClient: { getObjectInfo: mocks.getObjectInfo }
  }
}))

import { registerWorkflowPreparationTools } from '../../../../src/main/services/mcp/tools/workflow-preparation'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
async function call(args: Record<string, unknown>): Promise<CallToolResult> {
  let registered: { schema: z.ZodObject<z.ZodRawShape>; handler: Handler } | undefined
  registerWorkflowPreparationTools({
    tool: (_name: string, _description: string, schema: z.ZodRawShape, handler: Handler) => {
      registered = { schema: z.object(schema), handler }
    }
  } as unknown as McpServer)
  return registered!.handler(registered!.schema.parse(args))
}

function catalog(): Record<string, unknown> {
  return {
    CustomImage: {
      input: {
        required: { prompt: ['STRING'], width: ['INT', { min: 1, max: 2048 }], active: ['BOOLEAN'] }
      },
      output: ['IMAGE'],
      output_name: ['image'],
      output_is_list: [false],
      name: 'CustomImage',
      display_name: 'Custom image',
      description: 'Installed custom node',
      category: 'test',
      output_node: false
    },
    SaveImage: {
      input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } },
      output: [],
      output_name: [],
      output_is_list: [],
      name: 'SaveImage',
      display_name: 'Save image',
      description: '',
      category: 'image',
      output_node: true
    }
  }
}
const graph = {
  '1': { class_type: 'CustomImage', inputs: { prompt: 'portrait', width: 512, active: true } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'preview' } }
}
const content = JSON.stringify(graph)
const input = {
  name: 'Prepared custom workflow',
  source: { kind: 'api_json', content },
  roles: [{ node_id: '1', field: 'prompt', role: 'prompt_positive' }]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connected = true
  mocks.getObjectInfo.mockResolvedValue(catalog())
  mocks.get.mockReturnValue({ id: 'source-id', api_json: content })
  mocks.getVariables.mockReturnValue([
    { node_id: '1', field_name: 'prompt', role: 'prompt_positive' }
  ])
})

describe('MCP workflow preparation using the real preparation and validation services', () => {
  it('previews graph, detected roles, validation and token without persisting', async () => {
    const result = await call(input)
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      dry_run: true,
      name: input.name,
      category: 'custom',
      node_count: 2,
      validation: { valid: true, errors: [] },
      batch_ready: true,
      preparation_token: expect.stringMatching(/^[a-f0-9]{64}$/),
      api_json: graph,
      variables: expect.arrayContaining([
        expect.objectContaining({ nodeId: '1', fieldName: 'prompt', role: 'prompt_positive' })
      ])
    })
    expect(mocks.getObjectInfo).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('saves with the preview token and installs the reviewed variable roles atomically', async () => {
    const preview = await call(input)
    const result = await call({
      ...input,
      dry_run: false,
      preparation_token: preview.structuredContent!.preparation_token
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      workflow_id: 'workflow-new',
      dry_run: false,
      next_step: { tool: 'get_workflow', arguments: { id: 'workflow-new' } }
    })
    expect(mocks.getObjectInfo).toHaveBeenCalledTimes(2)
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: input.name, category: 'custom', api_json: content })
    )
    expect(mocks.setVariables).toHaveBeenCalledWith(
      'workflow-new',
      expect.arrayContaining([
        expect.objectContaining({ node_id: '1', field_name: 'prompt', role: 'prompt_positive' })
      ])
    )
  })

  it('requires a token and invalidates it when live node schemas change', async () => {
    const preview = await call(input)
    const missing = await call({ ...input, dry_run: false })
    expect(missing.isError).toBe(true)
    expect(missing.structuredContent!.error).toContain('preparation_token')
    const changed = catalog()
    ;(changed.CustomImage as Record<string, unknown>).description = 'Installed node updated'
    mocks.getObjectInfo.mockResolvedValueOnce(changed)
    const stale = await call({
      ...input,
      dry_run: false,
      preparation_token: preview.structuredContent!.preparation_token
    })
    expect(stale.isError).toBe(true)
    expect(stale.structuredContent!.error).toContain('stale')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('invalidates reviewed tokens after input changes', async () => {
    const preview = await call(input)
    const result = await call({
      ...input,
      input_updates: [{ node_id: '1', field: 'width', value: 768 }],
      dry_run: false,
      preparation_token: preview.structuredContent!.preparation_token
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('stale')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('blocks saving invalid graphs while returning actionable static validation results', async () => {
    const invalid = { ...input, input_updates: [{ node_id: '1', field: 'width', value: 3000 }] }
    const result = await call({ ...invalid, dry_run: false, preparation_token: '0'.repeat(64) })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      validation: {
        valid: false,
        errors: expect.arrayContaining([expect.objectContaining({ node_id: '1', field: 'width' })])
      },
      batch_ready: false
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('clones a saved workflow and roles without altering the original source', async () => {
    const saved = Object.freeze({ id: 'source-id', api_json: content, name: 'Original' })
    mocks.get.mockReturnValue(saved)
    const clone = {
      name: 'Variant',
      source: { kind: 'saved_workflow', workflow_id: 'source-id' },
      input_updates: [{ node_id: '1', field: 'prompt', value: 'new portrait' }]
    }
    const preview = await call(clone)
    const result = await call({
      ...clone,
      dry_run: false,
      preparation_token: preview.structuredContent!.preparation_token
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent!.workflow_id).toBe('workflow-new')
    expect(mocks.get).toHaveBeenCalledWith('source-id')
    expect(mocks.getVariables).toHaveBeenCalledWith('source-id')
    expect(saved.api_json).toBe(content)
    expect(saved.name).toBe('Original')
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Variant',
        api_json: expect.stringContaining('new portrait')
      })
    )
    expect(mocks.setVariables).toHaveBeenCalledWith(
      'workflow-new',
      expect.arrayContaining([expect.objectContaining({ node_id: '1', role: 'prompt_positive' })])
    )
  })

  it('rejects a missing saved source without persisting', async () => {
    mocks.get.mockReturnValue(null)
    const result = await call({
      name: 'Clone',
      source: { kind: 'saved_workflow', workflow_id: 'missing' }
    })
    expect(result.isError).toBe(true)
    expect(mocks.getObjectInfo).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects malformed saved API data without persisting', async () => {
    mocks.get.mockReturnValue({ id: 'source-id', api_json: null })
    const result = await call({
      name: 'Clone',
      source: { kind: 'saved_workflow', workflow_id: 'source-id' }
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('API JSON is invalid')
    expect(mocks.getObjectInfo).toHaveBeenCalledOnce()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('uses source changes made while the live catalog request is pending to invalidate old tokens', async () => {
    const clone = { name: 'Clone', source: { kind: 'saved_workflow', workflow_id: 'source-id' } }
    const preview = await call(clone)
    mocks.getObjectInfo.mockImplementationOnce(async () => {
      const changedGraph = structuredClone(graph)
      changedGraph['1'].inputs.prompt = 'Changed by user during catalog request'
      mocks.get.mockReturnValue({ id: 'source-id', api_json: JSON.stringify(changedGraph) })
      return catalog()
    })
    const result = await call({
      ...clone,
      dry_run: false,
      preparation_token: preview.structuredContent!.preparation_token
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('stale')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('refuses disconnected preparation and reports catalog fetch failures', async () => {
    mocks.connected = false
    expect((await call(input)).isError).toBe(true)
    expect(mocks.getObjectInfo).not.toHaveBeenCalled()
    mocks.connected = true
    mocks.getObjectInfo.mockRejectedValueOnce(new Error('catalog timeout'))
    const result = await call(input)
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('catalog timeout')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('reports variable storage failure instead of claiming a new workflow exists', async () => {
    const preview = await call(input)
    mocks.setVariables.mockImplementationOnce(() => {
      throw new Error('variable storage failed')
    })
    const result = await call({
      ...input,
      dry_run: false,
      preparation_token: preview.structuredContent!.preparation_token
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('variable storage failed')
    expect(result.structuredContent).not.toHaveProperty('workflow_id')
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it.each(['{}', '[]', '{', '{"nodes":[],"links":[]}', 'C:\\private\\workflow.json'])(
    'rejects invalid source content without persistence: %s',
    async (invalid) => {
      expect(
        (await call({ name: 'Invalid', source: { kind: 'api_json', content: invalid } })).isError
      ).toBe(true)
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it('enforces UTF-8 byte limits before constructing a prepared graph', async () => {
    const oversized = JSON.stringify({
      '1': {
        class_type: 'Custom',
        inputs: { text: '한'.repeat(Math.ceil(MAX_WORKFLOW_FILE_SIZE_BYTES / 3)) }
      }
    })
    const result = await call({
      name: 'Oversized',
      source: { kind: 'api_json', content: oversized }
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent!.error).toContain('10MB')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects invalid source and token structures at the schema boundary', async () => {
    await expect(call({ ...input, source: { kind: 'unsupported' } })).rejects.toThrow()
    await expect(call({ ...input, preparation_token: 'bad-token' })).rejects.toThrow()
    expect(mocks.getObjectInfo).not.toHaveBeenCalled()
  })
})
