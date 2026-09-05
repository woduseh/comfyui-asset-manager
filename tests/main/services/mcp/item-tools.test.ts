import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  get: vi.fn(),
  moduleGet: vi.fn(),
  bulkCreate: vi.fn(),
  bulkUpdate: vi.fn(),
  isLoaded: vi.fn(),
  load: vi.fn(),
  validate: vi.fn()
}))
vi.mock('../../../../src/main/services/mcp/tools/shared', () => ({
  moduleRepo: { get: mocks.moduleGet, list: () => [{ id: 'module' }] },
  moduleItemRepo: {
    list: mocks.list,
    count: mocks.count,
    get: mocks.get,
    bulkCreate: mocks.bulkCreate,
    bulkUpdate: mocks.bulkUpdate
  }
}))
vi.mock('../../../../src/main/services/tags', () => ({
  tagService: {
    isLoaded: mocks.isLoaded,
    load: mocks.load,
    validate: mocks.validate,
    getTagCount: () => 1,
    lastError: 'unavailable'
  }
}))
import { registerItemBulkTools } from '../../../../src/main/services/mcp/tools/item-bulk'
import { registerItemCoreTools } from '../../../../src/main/services/mcp/tools/items'
import { registerItemOperationTools } from '../../../../src/main/services/mcp/tools/item-operations'
import { registerModuleAnalysisTools } from '../../../../src/main/services/mcp/tools/module-analysis'

type Result = { content: Array<{ text: string }>; isError?: boolean }
type Handler = (args: Record<string, unknown>) => Promise<Result>
function tools(): { call: (name: string, args: Record<string, unknown>) => Promise<Result> } {
  const handlers = new Map<string, { schema: z.ZodRawShape; handler: Handler }>()
  const server = {
    tool: (name: string, _: string, schema: z.ZodRawShape, handler: Handler) =>
      handlers.set(name, { schema, handler })
  } as unknown as McpServer
  registerItemCoreTools(server)
  registerItemBulkTools(server)
  registerItemOperationTools(server)
  registerModuleAnalysisTools(server)
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      const tool = handlers.get(name)!
      return tool.handler(z.object(tool.schema).parse(args))
    }
  }
}
// Tool responses are intentionally inspected as runtime JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decode = (result: Result): Record<string, any> => JSON.parse(result.content[0].text)

describe('MCP item authoring and inspection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.list.mockReturnValue([])
    mocks.count.mockReturnValue(0)
    mocks.get.mockReturnValue({ id: 'item' })
    mocks.moduleGet.mockReturnValue({ id: 'module' })
    mocks.bulkUpdate.mockReturnValue({ succeeded: 1, failed: 0, errors: [] })
    mocks.isLoaded.mockReturnValue(true)
    mocks.validate.mockResolvedValue({ results: [], onlineAvailable: false })
  })

  it('bounds default listing and returns object variants with navigation', async () => {
    mocks.count.mockReturnValue(70)
    mocks.list.mockReturnValue([
      { id: 'item', prompt_variants: '{"tags":{"prompt":"smile","negative":""}}' }
    ])
    const result = decode(
      await tools().call('list_module_items', { module_id: 'module', offset: 5 })
    )
    expect(mocks.list).toHaveBeenCalledWith('module', { limit: 50, offset: 5 })
    expect(result).toMatchObject({
      total: 70,
      has_more: true,
      offset: 5,
      limit: 50,
      items: [{ prompt_variants: { tags: { prompt: 'smile', negative: '' } } }]
    })
    await expect(
      tools().call('list_module_items', { module_id: 'module', limit: -1 })
    ).rejects.toThrow()
    await expect(
      tools().call('list_module_items', { module_id: 'module', offset: 0.5 })
    ).rejects.toThrow()
  })

  it('searches the requested variant and field only, with filtered pagination', async () => {
    mocks.list.mockReturnValue([
      { id: 'a', prompt: '', prompt_variants: '{"tags":{"prompt":"smile","negative":""}}' },
      {
        id: 'b',
        prompt: '',
        prompt_variants: '{"natural_language":{"prompt":"smile","negative":""}}'
      },
      { id: 'c', prompt: '', prompt_variants: '{"tags":{"prompt":"","negative":"smile"}}' },
      { id: 'd', prompt: 'smile' }
    ])
    const result = decode(
      await tools().call('list_module_items', {
        module_id: 'module',
        query: 'SMILE',
        field: 'prompt',
        variant_names: ['tags'],
        offset: 1,
        limit: 1
      })
    )
    expect(result).toMatchObject({
      total: 2,
      offset: 1,
      has_more: false,
      items: [{ id: 'd', matched_fields: ['prompt'] }]
    })
  })

  it('updates one or many items with partial failures and explicit enabled persistence', async () => {
    mocks.bulkUpdate.mockReturnValueOnce({
      succeeded: 1,
      failed: 1,
      errors: [{ id: 'missing', error: 'Module item not found' }]
    })
    const result = decode(
      await tools().call('update_module_items', {
        items: [
          { id: 'missing', enabled: false },
          { id: 'item', enabled: false }
        ]
      })
    )
    expect(result).toEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      errors: [{ id: 'missing', error: 'Module item not found' }]
    })
    expect(mocks.bulkUpdate).toHaveBeenCalledWith([
      { id: 'missing', data: { enabled: 0 } },
      { id: 'item', data: { enabled: 0 } }
    ])
    await tools().call('update_module_items', { items: [{ id: 'item', enabled: true }] })
    expect(mocks.bulkUpdate).toHaveBeenLastCalledWith([{ id: 'item', data: { enabled: 1 } }])
  })

  it('creates an array of one and reports partial creation failures with their source indexes', async () => {
    mocks.bulkCreate.mockReturnValueOnce({ succeeded: 1, failed: 0, ids: ['created'], errors: [] })
    const single = decode(
      await tools().call('create_module_items', {
        module_id: 'module',
        items: [{ name: 'Happy', prompt: 'smile' }]
      })
    )
    expect(single).toMatchObject({ total: 1, succeeded: 1, ids: ['created'] })
    mocks.bulkCreate.mockReturnValueOnce({
      succeeded: 1,
      failed: 1,
      ids: ['second'],
      errors: [{ index: 1, error: 'write failed' }]
    })
    const multiple = decode(
      await tools().call('create_module_items', {
        module_id: 'module',
        items: [
          { name: 'Sad', prompt: 'sad' },
          { name: 'Angry', prompt: 'angry' }
        ]
      })
    )
    expect(multiple).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: 1,
      ids: ['second'],
      errors: [{ index: 1, error: 'write failed' }]
    })
    mocks.moduleGet.mockReturnValueOnce(null)
    expect(
      (
        await tools().call('create_module_items', {
          module_id: 'missing',
          items: [{ name: 'Happy', prompt: 'smile' }]
        })
      ).isError
    ).toBe(true)
    expect(mocks.bulkCreate).toHaveBeenCalledTimes(2)
  })

  it('rejects empty, oversized and non-finite mutation input before repository writes', async () => {
    for (const tool of ['create_module_items', 'update_module_items']) {
      await expect(tools().call(tool, { module_id: 'module', items: [] })).rejects.toThrow()
      await expect(
        tools().call(tool, {
          module_id: 'module',
          items: Array.from({ length: 201 }, () => ({ id: 'item', name: 'Happy', prompt: 'smile' }))
        })
      ).rejects.toThrow()
      await expect(
        tools().call(tool, {
          module_id: 'module',
          items: [{ id: 'item', name: 'Happy', prompt: 'smile', weight: Infinity }]
        })
      ).rejects.toThrow()
    }
    await expect(tools().call('update_module_items', { items: [{ id: 'item' }] })).rejects.toThrow()
    expect(mocks.bulkUpdate).not.toHaveBeenCalled()
    expect(mocks.bulkCreate).not.toHaveBeenCalled()
  })

  it('counts enabled independently of weight', async () => {
    mocks.list.mockReturnValue([
      { enabled: 0, weight: 1 },
      { enabled: 1, weight: 0 }
    ])
    expect(decode(await tools().call('get_module_stats', { module_id: 'module' }))).toMatchObject({
      enabled_items: 1,
      disabled_items: 1
    })
  })

  it('reports applied replacement failures instead of claiming planned changes succeeded', async () => {
    mocks.list.mockReturnValue([
      { id: 'a', prompt: 'smile' },
      { id: 'b', prompt: 'smile' }
    ])
    mocks.bulkUpdate.mockReturnValue({
      succeeded: 1,
      failed: 1,
      errors: [{ id: 'b', error: 'write failed' }]
    })
    const result = decode(
      await tools().call('replace_tag_in_module', {
        module_id: 'module',
        old_tag: 'smile',
        new_tag: 'grin'
      })
    )
    expect(result).toMatchObject({
      matched_items: 2,
      modified_items: 1,
      succeeded: 1,
      failed: 1,
      errors: [{ id: 'b' }]
    })
  })

  it('previews replacement without claiming a write or modifying natural-language variants', async () => {
    mocks.list.mockReturnValue([
      {
        id: 'a',
        prompt: 'smile',
        prompt_variants:
          '{"natural_language":{"prompt":"smile","negative":""},"tags":{"prompt":"smile","negative":""}}'
      }
    ])
    const result = decode(
      await tools().call('replace_tag_in_module', {
        module_id: 'module',
        old_tag: 'smile',
        new_tag: 'grin',
        variant_names: ['tags'],
        include_default: false,
        dry_run: true
      })
    )
    expect(result.modified_items).toBe(0)
    expect(result.modifications[0].changes).toEqual([
      { field: 'variant:tags:prompt', before: 'smile', after: 'grin' }
    ])
    expect(mocks.bulkUpdate).not.toHaveBeenCalled()
  })

  it('stops validation if the tag database failed to load', async () => {
    mocks.isLoaded.mockReturnValue(false)
    expect((await tools().call('validate_module_tags', { module_id: 'module' })).isError).toBe(true)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.validate).not.toHaveBeenCalled()
  })

  it('excludes natural-language variants and optional natural-language defaults from tag validation', async () => {
    mocks.list.mockReturnValue([
      {
        prompt: 'A cheerful character',
        prompt_variants:
          '{"tags":{"prompt":"smile","negative":""},"natural_language":{"prompt":"A happy character","negative":""}}'
      }
    ])
    await tools().call('validate_module_tags', { module_id: 'module', include_default: false })
    expect(mocks.validate).toHaveBeenCalledWith(['smile'], true)
  })
})
