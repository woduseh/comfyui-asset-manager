import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { openTestDatabase, type TestDatabase } from '../../../helpers/database'

const state = vi.hoisted(() => ({ userDataPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userDataPath } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
let database: typeof import('../../../../src/main/services/database')
let shared: typeof import('../../../../src/main/services/mcp/tools/shared')
let sync: Handler
let moduleId: string
let fixture: TestDatabase
let filePath: string

beforeEach(async () => {
  vi.resetModules()
  fixture = await openTestDatabase((path) => {
    state.userDataPath = path
  })
  database = fixture.database
  filePath = join(fixture.directory, 'items.json')
  shared = await import('../../../../src/main/services/mcp/tools/shared')
  moduleId = shared.moduleRepo.create({ name: 'Characters', type: 'character' })
  shared.moduleItemRepo.create({ module_id: moduleId, name: 'Alice', prompt: 'original' })
  const { registerFileSyncTools } =
    await import('../../../../src/main/services/mcp/tools/file-sync')
  registerFileSyncTools({
    tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
      if (name === 'sync_module_from_file') sync = handler
    }
  } as unknown as McpServer)
})

afterEach(async () => {
  await fixture.close()
})

describe('MCP file sync transaction integration', () => {
  it('applies a real source file atomically and preserves its fields after reopening', async () => {
    shared.moduleItemRepo.update(String(shared.moduleItemRepo.list(moduleId)[0].id), {
      negative: 'keep negative',
      prompt_variants: '{"tags":{"prompt":"keep variant","negative":""}}'
    })
    shared.moduleItemRepo.create({ module_id: moduleId, name: 'Removed', prompt: 'old' })
    writeFileSync(
      filePath,
      JSON.stringify([
        { name: ' alice ', prompt: 'changed' },
        {
          name: 'Bob',
          prompt: 'new',
          negative: 'blurry',
          prompt_variants: { tags: { prompt: 'new variant', negative: '' } }
        }
      ])
    )
    const result = await sync({ module_id: moduleId, file_path: filePath, delete_missing: true })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      created: 1,
      updated: 1,
      deleted: 1,
      errors: []
    })
    await database.closeDatabase()
    await database.initDatabase()
    expect(
      shared.moduleItemRepo.list(moduleId).map(({ name, prompt, negative, prompt_variants }) => ({
        name,
        prompt,
        negative,
        prompt_variants
      }))
    ).toEqual([
      {
        name: 'Alice',
        prompt: 'changed',
        negative: 'keep negative',
        prompt_variants: '{"tags":{"prompt":"keep variant","negative":""}}'
      },
      {
        name: 'Bob',
        prompt: 'new',
        negative: 'blurry',
        prompt_variants: '{"tags":{"prompt":"new variant","negative":""}}'
      }
    ])
  })

  it('rejects a partially valid source file before changing or deleting stored items', async () => {
    const before = shared.moduleItemRepo.list(moduleId)
    writeFileSync(filePath, '[{"name":"Bob","prompt":"new"},{"name":"Invalid"}]')
    const result = await sync({ module_id: moduleId, file_path: filePath, delete_missing: true })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      created: 0,
      updated: 0,
      deleted: 0,
      parse_errors: [{ line: 2, error: expect.stringContaining('prompt') }]
    })
    expect(shared.moduleItemRepo.list(moduleId)).toEqual(before)
  })

  it('rolls back successful inserts when another insert fails in the same bulk call', async () => {
    database.getDatabase().run(`CREATE TRIGGER reject_insert BEFORE INSERT ON module_items
      WHEN NEW.name = 'Rejected' BEGIN SELECT RAISE(ABORT, 'Rejected by test'); END`)
    writeFileSync(
      filePath,
      JSON.stringify([
        { name: 'Bob', prompt: 'new' },
        { name: 'Rejected', prompt: 'new' }
      ])
    )
    const result = await sync({
      module_id: moduleId,
      file_path: filePath,
      delete_missing: true
    })
    expect(result.isError).toBe(true)
    expect(shared.moduleItemRepo.list(moduleId).map((item) => item.name)).toEqual(['Alice'])
  })

  it('rolls back creates and updates when deletion fails', async () => {
    shared.moduleItemRepo.create({ module_id: moduleId, name: 'Retained', prompt: 'old' })
    database.getDatabase().run(`CREATE TRIGGER reject_delete BEFORE DELETE ON module_items
      WHEN OLD.name = 'Alice' BEGIN SELECT RAISE(ABORT, 'Rejected by test'); END`)
    writeFileSync(
      filePath,
      JSON.stringify([
        { name: 'Bob', prompt: 'new' },
        { name: 'Retained', prompt: 'changed' }
      ])
    )
    const result = await sync({
      module_id: moduleId,
      file_path: filePath,
      delete_missing: true
    })
    expect(result.isError).toBe(true)
    expect(
      shared.moduleItemRepo.list(moduleId).map((item) => ({ name: item.name, prompt: item.prompt }))
    ).toEqual([
      { name: 'Alice', prompt: 'original' },
      { name: 'Retained', prompt: 'old' }
    ])
  })
})
