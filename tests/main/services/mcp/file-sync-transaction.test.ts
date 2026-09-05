import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'

const state = vi.hoisted(() => ({ userDataPath: '', parse: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => state.userDataPath } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../../../src/main/services/mcp/file-parser', () => ({
  parseModuleItemsFile: state.parse
}))

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
let database: typeof import('../../../../src/main/services/database')
let shared: typeof import('../../../../src/main/services/mcp/tools/shared')
let sync: Handler
let moduleId: string

beforeEach(async () => {
  vi.resetModules()
  state.userDataPath = mkdtempSync(join(tmpdir(), 'comfyui-mcp-sync-test-'))
  database = await import('../../../../src/main/services/database')
  await database.initDatabase()
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
  await database.closeDatabase()
  const target = resolve(state.userDataPath)
  const relativePath = relative(resolve(tmpdir()), target)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    !basename(target).startsWith('comfyui-mcp-sync-test-')
  ) {
    throw new Error(`Refusing to remove unexpected test directory: ${target}`)
  }
  rmSync(target, { recursive: true, force: true })
})

describe('MCP file sync transaction integration', () => {
  it('rolls back successful inserts when another insert fails in the same bulk call', async () => {
    database.getDatabase().run(`CREATE TRIGGER reject_insert BEFORE INSERT ON module_items
      WHEN NEW.name = 'Rejected' BEGIN SELECT RAISE(ABORT, 'Rejected by test'); END`)
    state.parse.mockReturnValue({
      format: 'json',
      errors: [],
      items: [
        { name: 'Bob', prompt: 'new' },
        { name: 'Rejected', prompt: 'new' }
      ]
    })
    const result = await sync({
      module_id: moduleId,
      file_path: '/unused.json',
      delete_missing: true
    })
    expect(result.isError).toBe(true)
    expect(shared.moduleItemRepo.list(moduleId).map((item) => item.name)).toEqual(['Alice'])
  })

  it('rolls back creates and updates when deletion fails', async () => {
    shared.moduleItemRepo.create({ module_id: moduleId, name: 'Retained', prompt: 'old' })
    database.getDatabase().run(`CREATE TRIGGER reject_delete BEFORE DELETE ON module_items
      WHEN OLD.name = 'Alice' BEGIN SELECT RAISE(ABORT, 'Rejected by test'); END`)
    state.parse.mockReturnValue({
      format: 'json',
      errors: [],
      items: [
        { name: 'Bob', prompt: 'new' },
        { name: 'Retained', prompt: 'changed' }
      ]
    })
    const result = await sync({
      module_id: moduleId,
      file_path: '/unused.json',
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
