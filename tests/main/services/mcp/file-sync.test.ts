import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  bulkCreate: vi.fn(),
  bulkUpdate: vi.fn(),
  delete: vi.fn(),
  parse: vi.fn(),
  write: vi.fn()
}))

vi.mock('../../../../src/main/services/database', () => ({
  withTransaction: (fn: () => unknown) => fn()
}))

vi.mock('../../../../src/main/services/mcp/tools/shared', () => ({
  moduleRepo: { get: mocks.get },
  moduleItemRepo: {
    list: mocks.list,
    bulkCreate: mocks.bulkCreate,
    bulkUpdate: mocks.bulkUpdate,
    delete: mocks.delete
  }
}))
vi.mock('../../../../src/main/services/mcp/file-parser', () => ({
  parseModuleItemsFile: mocks.parse
}))
vi.mock('../../../../src/main/services/mcp/file-serializer', () => ({
  writeModuleItemsFile: mocks.write
}))

import { registerFileSyncTools } from '../../../../src/main/services/mcp/tools/file-sync'
import { registerFileImportTools } from '../../../../src/main/services/mcp/tools/file-import'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
const handlers = new Map<string, Handler>()
const server = {
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
    handlers.set(name, handler)
  }
} as unknown as McpServer
registerFileSyncTools(server)
registerFileImportTools(server)

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return handlers.get(name)!({ module_id: 'module', file_path: '/items.json', ...args })
}

function payload(result: CallToolResult): unknown {
  const content = result.content[0]
  if (content.type !== 'text') throw new Error('Expected text response')
  return JSON.parse(content.text)
}

describe('MCP file export and synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockReturnValue({ name: 'Characters' })
    mocks.list.mockReturnValue([
      { id: 'alice', name: 'Alice', prompt: 'blue_eyes', prompt_variants: '{broken' }
    ])
    mocks.parse.mockReturnValue({
      format: 'json',
      items: [{ name: 'Alice', prompt: 'blue_eyes' }],
      errors: []
    })
    mocks.write.mockReturnValue({ filePath: '/items.json', format: 'json', size: 100 })
    mocks.bulkCreate.mockReturnValue({ succeeded: 1, failed: 0, errors: [] })
    mocks.bulkUpdate.mockReturnValue({ succeeded: 1, failed: 0, errors: [] })
  })

  it('exports base fields while dropping malformed stored variants', async () => {
    const result = await call('export_module_items_to_file')

    expect(mocks.write).toHaveBeenCalledWith(
      [{ name: 'Alice', prompt: 'blue_eyes', negative: undefined, prompt_variants: undefined }],
      '/items.json',
      undefined
    )
    expect(payload(result)).toMatchObject({ items_exported: 1, module_name: 'Characters' })
  })

  it('preserves valid variants and filters invalid entries during export', async () => {
    mocks.list.mockReturnValue([
      {
        name: 'Alice',
        prompt: 'blue_eyes',
        negative: 'blurry',
        prompt_variants: JSON.stringify({ valid: { prompt: 'Alice', negative: '' }, invalid: null })
      }
    ])

    await call('export_module_items_to_file')

    expect(mocks.write.mock.calls[0][0][0]).toEqual({
      name: 'Alice',
      prompt: 'blue_eyes',
      negative: 'blurry',
      prompt_variants: { valid: { prompt: 'Alice', negative: '' } }
    })
  })

  it('compares malformed stored variants as absent in diff and dry-run sync', async () => {
    const diff = payload(await call('diff_module_with_file'))
    const preview = payload(await call('sync_module_from_file', { dry_run: true }))

    expect(diff).toMatchObject({ summary: { modified: 0, unchanged: 1 } })
    expect(preview).toMatchObject({ summary: { will_create: 0, will_update: 0, will_delete: 0 } })
    expect(mocks.bulkCreate).not.toHaveBeenCalled()
    expect(mocks.bulkUpdate).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('reports parse errors without mutating the module', async () => {
    mocks.parse.mockImplementationOnce(() => {
      throw new Error('Invalid file')
    })

    const result = await call('sync_module_from_file')

    expect(result.isError).toBe(true)
    expect(payload(result)).toEqual({ error: 'Invalid file' })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it.each(['diff_module_with_file', 'import_module_items_from_file'])(
    '%s rejects partially parsed input instead of reporting a usable result',
    async (tool) => {
      mocks.parse.mockReturnValue({
        format: 'json',
        items: [{ name: 'Valid', prompt: 'valid' }],
        errors: [{ line: 2, error: 'Invalid item' }]
      })
      const result = await call(tool)
      expect(result.isError).toBe(true)
      expect(payload(result)).toMatchObject({ parse_errors: [{ line: 2, error: 'Invalid item' }] })
      expect(mocks.bulkCreate).not.toHaveBeenCalled()
    }
  )

  it('deletes only missing database items when requested', async () => {
    mocks.parse.mockReturnValue({ format: 'json', items: [], errors: [] })

    const result = await call('sync_module_from_file', { delete_missing: true })

    expect(mocks.delete).toHaveBeenCalledWith('alice')
    expect(payload(result)).toMatchObject({ created: 0, updated: 0, deleted: 1 })
  })

  it.each([false, true])(
    'blocks destructive sync with parse errors (dry_run=%s)',
    async (dry_run) => {
      mocks.parse.mockReturnValue({
        format: 'json',
        items: [],
        errors: [{ line: 1, error: 'Invalid JSON' }]
      })
      const result = await call('sync_module_from_file', { delete_missing: true, dry_run })
      expect(result.isError).toBe(true)
      expect(payload(result)).toMatchObject({
        parse_errors: [{ line: 1, error: 'Invalid JSON' }],
        deleted: 0
      })
      expect(mocks.bulkCreate).not.toHaveBeenCalled()
      expect(mocks.bulkUpdate).not.toHaveBeenCalled()
      expect(mocks.delete).not.toHaveBeenCalled()
    }
  )

  it('preserves omitted fields and clears explicitly empty fields consistently with preview', async () => {
    mocks.list.mockReturnValue([
      {
        id: 'alice',
        name: 'Alice',
        prompt: 'blue_eyes',
        negative: 'blurry',
        prompt_variants: '{"tags":{"prompt":"blue_eyes","negative":""}}'
      }
    ])
    expect(payload(await call('sync_module_from_file', { dry_run: true }))).toMatchObject({
      summary: { will_update: 0 }
    })
    mocks.parse.mockReturnValue({
      format: 'json',
      items: [{ name: 'Alice', prompt: 'blue_eyes', negative: '', prompt_variants: {} }],
      errors: []
    })
    expect(payload(await call('sync_module_from_file', { dry_run: true }))).toMatchObject({
      summary: { will_update: 1 }
    })
    await call('sync_module_from_file')
    expect(mocks.bulkUpdate).toHaveBeenCalledWith([
      { id: 'alice', data: { prompt: 'blue_eyes', negative: '', prompt_variants: '{}' } }
    ])
  })

  it.each(['source', 'module'])(
    'rejects ambiguous normalized %s names before writing',
    async (source) => {
      const items = [
        { id: 'alice', name: 'Alice', prompt: 'a' },
        { id: 'other', name: ' alice ', prompt: 'b' }
      ]
      if (source === 'source') mocks.parse.mockReturnValue({ format: 'json', items, errors: [] })
      else mocks.list.mockReturnValue(items)
      const result = await call('sync_module_from_file', { delete_missing: true })
      expect(result.isError).toBe(true)
      expect(mocks.bulkCreate).not.toHaveBeenCalled()
      expect(mocks.bulkUpdate).not.toHaveBeenCalled()
      expect(mocks.delete).not.toHaveBeenCalled()
    }
  )

  it('reports rollback and skips deletion after a bulk mutation failure', async () => {
    mocks.parse.mockReturnValue({
      format: 'json',
      items: [{ name: 'Bob', prompt: 'red_eyes' }],
      errors: []
    })
    mocks.bulkCreate.mockReturnValue({
      succeeded: 0,
      failed: 1,
      errors: [{ index: 0, error: 'Insert failed' }]
    })
    const result = await call('sync_module_from_file', { delete_missing: true })
    expect(result.isError).toBe(true)
    expect(payload(result)).toMatchObject({
      rolled_back: true,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [{ action: 'create', name: 'Bob', error: 'Insert failed' }]
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })
})
