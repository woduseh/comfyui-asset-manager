import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ flush: vi.fn() }))
vi.mock('../../../../src/main/services/database', () => ({ flushDatabase: mocks.flush }))

import {
  withToolContracts,
  toolAnnotations
} from '../../../../src/main/services/mcp/tools/tool-contract'
import { jsonError, jsonResult } from '../../../../src/main/services/mcp/tools/response'

let server: McpServer
let client: Client
let tools: McpServer

beforeEach(() => {
  mocks.flush.mockReset().mockResolvedValue(undefined)
  server = new McpServer({ name: 'contract-test-server', version: '1.0.0' })
  client = new Client({ name: 'contract-test-client', version: '1.0.0' })
  tools = withToolContracts(server)
})

afterEach(async () => {
  await client.close()
  await server.close()
})

async function connect(): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
}

describe('MCP contracts over the SDK in-memory transport', () => {
  it('marks file exports as potentially destructive external writes', () => {
    expect(toolAnnotations('export_module_items_to_file')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    })
    expect(toolAnnotations('diff_module_with_file')).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    })
  })
  it('advertises validated schemas and behavior annotations through tools/list', async () => {
    tools.tool('get_sample', 'Read a sample', { id: z.string().min(1) }, async () =>
      jsonResult({ id: 'one' })
    )
    tools.tool(
      'review_generated_image',
      'Set review state',
      { rating: z.number().int().min(0).max(5) },
      async () => jsonResult({ success: true })
    )
    tools.tool('start_batch_job', 'Submit a batch', { id: z.string() }, async () =>
      jsonResult({ id: 'job' })
    )
    await connect()

    const listed = await client.listTools()
    const read = listed.tools.find((tool) => tool.name === 'get_sample')!
    const write = listed.tools.find((tool) => tool.name === 'review_generated_image')!
    const external = listed.tools.find((tool) => tool.name === 'start_batch_job')!
    expect(read.inputSchema).toMatchObject({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', minLength: 1 } }
    })
    expect(read.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    })
    expect(write.inputSchema).toMatchObject({
      properties: { rating: { type: 'integer', minimum: 0, maximum: 5 } }
    })
    expect(write.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true
    })
    expect(external.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: true,
      idempotentHint: false
    })
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('rejects invalid tool inputs before invoking the handler or flushing', async () => {
    const handler = vi.fn(async () => jsonResult({ success: true }))
    tools.tool(
      'review_generated_image',
      'Set rating',
      { rating: z.number().int().min(0).max(5) },
      handler
    )
    await connect()

    for (const rating of [-1, 6, 1.5, 'five']) {
      const result = await client.callTool({
        name: 'review_generated_image',
        arguments: { rating }
      })
      expect(result.isError).toBe(true)
    }
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('preserves structured metadata and actual image content without flushing readonly tools', async () => {
    tools.tool('get_sample', 'Read image', {}, async () => {
      const result = jsonResult({ id: 'image-1', width: 1, height: 1 })
      result.content.push({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' })
      return result
    })
    await connect()

    const result = await client.callTool({ name: 'get_sample', arguments: {} })
    expect(result.structuredContent).toEqual({ id: 'image-1', width: 1, height: 1 })
    expect(result.content).toEqual([
      { type: 'text', text: '{"id":"image-1","width":1,"height":1}' },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' }
    ])
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('wraps array responses for structuredContent while preserving legacy text JSON', async () => {
    tools.tool('list_samples', 'List samples', {}, async () => jsonResult([{ id: 'one' }]))
    await connect()
    const result = await client.callTool({ name: 'list_samples', arguments: {} })
    expect(result.structuredContent).toEqual({ items: [{ id: 'one' }] })
    expect(result.content).toEqual([{ type: 'text', text: '[{"id":"one"}]' }])
  })

  it('converts a thrown handler failure into an isError tool result', async () => {
    tools.tool('create_sample', 'Create sample', {}, async () => {
      throw new Error('creation failed')
    })
    await connect()
    const result = await client.callTool({ name: 'create_sample', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: 'creation failed' })
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('confirms durability before returning a successful mutation result', async () => {
    let completeFlush!: () => void
    mocks.flush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeFlush = resolve
        })
    )
    tools.tool('create_sample', 'Create sample', {}, async () => jsonResult({ id: 'created-id' }))
    await connect()
    let resolved = false
    const pending = client.callTool({ name: 'create_sample', arguments: {} }).then((result) => {
      resolved = true
      return result
    })
    await vi.waitFor(() => expect(mocks.flush).toHaveBeenCalledOnce())
    expect(resolved).toBe(false)
    completeFlush()
    expect((await pending).structuredContent).toEqual({ id: 'created-id' })
  })

  it('preserves created IDs and disables blind retry after a persistence failure', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('disk full'))
    tools.tool('create_sample', 'Create sample', {}, async () =>
      jsonResult({ id: 'created-id', created: true })
    )
    await connect()
    const result = await client.callTool({ name: 'create_sample', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      error: 'disk full',
      code: 'PERSISTENCE_UNCONFIRMED',
      retryable: false,
      result: { id: 'created-id', created: true },
      next_action: expect.stringContaining('Keep returned IDs')
    })
  })

  it('flushes explicit mutation error results so partial successes are not discarded', async () => {
    tools.tool('create_sample', 'Create sample', {}, async () => ({
      ...jsonResult({
        succeeded: 1,
        failed: 1,
        ids: ['created-id'],
        errors: ['second item failed']
      }),
      isError: true
    }))
    await connect()
    const result = await client.callTool({ name: 'create_sample', arguments: {} })
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ succeeded: 1, ids: ['created-id'] })
  })

  it('retains partial error data when its durability also cannot be confirmed', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('write interrupted'))
    tools.tool('create_sample', 'Create sample', {}, async () => ({
      ...jsonResult({ ids: ['partial-id'], error: 'some rows failed' }),
      isError: true
    }))
    await connect()
    const result = await client.callTool({ name: 'create_sample', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      code: 'PERSISTENCE_UNCONFIRMED',
      retryable: false,
      result: { ids: ['partial-id'], error: 'some rows failed' }
    })
  })

  it('returns readonly errors without attempting to flush unrelated pending saves', async () => {
    tools.tool('get_sample', 'Read sample', {}, async () => jsonError('not found'))
    await connect()
    expect((await client.callTool({ name: 'get_sample', arguments: {} })).isError).toBe(true)
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('preserves legacy content when a handler does not return structuredContent', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('disk full'))
    tools.tool('create_sample', 'Create sample', {}, async () => ({
      content: [{ type: 'text', text: 'Created ID legacy-id' }]
    }))
    await connect()
    const result = await client.callTool({ name: 'create_sample', arguments: {} })
    expect(result.structuredContent).toMatchObject({
      result: [{ type: 'text', text: 'Created ID legacy-id' }]
    })
  })
})
