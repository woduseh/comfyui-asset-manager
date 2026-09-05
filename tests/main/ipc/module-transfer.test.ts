import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels'

const state = vi.hoisted(() => ({
  userDataPath: '',
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataPath },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      state.handlers.set(channel, handler)
    }
  }
}))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/comfyui/manager', () => ({ comfyuiManager: {} }))
vi.mock('@main/services/comfyui/workflow-import', () => ({}))
vi.mock('@main/services/terminal/pty-manager', () => ({ ptyManager: {} }))
vi.mock('@main/services/mcp', () => ({ mcpServerManager: {} }))
vi.mock('@main/services/mcp/config-generator', () => ({}))
vi.mock('@main/services/mcp/auth', () => ({}))
vi.mock('@main/ipc/handlers/batch', () => ({ registerBatchHandlers: vi.fn() }))

let database: typeof import('../../../src/main/services/database')
let modules: InstanceType<
  typeof import('../../../src/main/services/database/repositories').ModuleRepository
>
let items: InstanceType<
  typeof import('../../../src/main/services/database/repositories').ModuleItemRepository
>
let sourceId: string

function invoke(channel: string, args: unknown): unknown {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler({}, args)
}

beforeEach(async () => {
  vi.resetModules()
  state.handlers.clear()
  state.userDataPath = mkdtempSync(join(tmpdir(), 'comfyui-module-transfer-test-'))
  database = await import('../../../src/main/services/database')
  await database.initDatabase()
  const repositories = await import('../../../src/main/services/database/repositories')
  modules = new repositories.ModuleRepository()
  items = new repositories.ModuleItemRepository()
  sourceId = modules.create({ name: 'Source', type: 'custom', description: 'Description' })
  const { registerIpcHandlers } = await import('../../../src/main/ipc/handlers')
  registerIpcHandlers()
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
    !basename(target).startsWith('comfyui-module-transfer-test-')
  ) {
    throw new Error(`Refusing to remove unexpected test directory: ${target}`)
  }
  rmSync(target, { recursive: true, force: true })
})

describe('module IPC data preservation', () => {
  it('round-trips its own export into new records without losing item content', () => {
    const variants = { natural: { prompt: 'a portrait', negative: 'blur' } }
    const itemId = items.create({
      module_id: sourceId,
      name: 'Alice',
      prompt: '1girl',
      negative: 'noise',
      weight: 0,
      sort_order: 0,
      metadata: '{"source":"original"}',
      prompt_variants: JSON.stringify(variants)
    })
    items.update(itemId, { enabled: 0 })
    const exported = invoke(IPC_CHANNELS.MODULE_EXPORT, { moduleId: sourceId })

    const imported = invoke(IPC_CHANNELS.MODULE_IMPORT_DATA, { jsonData: exported })

    expect(imported).toEqual({ id: expect.any(String), name: 'Source' })
    const importedId = (imported as { id: string }).id
    expect(importedId).not.toBe(sourceId)
    expect(modules.get(importedId)).toMatchObject({
      name: 'Source (imported)',
      type: 'custom',
      description: 'Description'
    })
    const copied = items.list(importedId)
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({
      module_id: importedId,
      name: 'Alice',
      prompt: '1girl',
      negative: 'noise',
      weight: 0,
      sort_order: 0,
      metadata: '{"source":"original"}',
      enabled: 0,
      prompt_variants: JSON.stringify(variants)
    })
    expect(copied[0].id).not.toBe(itemId)
    expect(items.get(itemId)).toMatchObject({ module_id: sourceId, enabled: 0 })
  })

  it('accepts a minimal legacy export and keeps defaults for omitted item fields', () => {
    const imported = invoke(IPC_CHANNELS.MODULE_IMPORT_DATA, {
      jsonData: JSON.stringify({
        module: { name: 'Legacy', type: 'custom' },
        items: [{ name: 'Alice', prompt: '1girl' }]
      })
    })
    expect(imported).toEqual({ id: expect.any(String), name: 'Legacy' })
    expect(items.list((imported as { id: string }).id)[0]).toMatchObject({
      negative: '',
      weight: 1,
      sort_order: 0,
      metadata: '{}',
      enabled: 1,
      prompt_variants: '{}'
    })
  })

  it('allows the UI enabled flag while rejecting unknown or invalid update fields', () => {
    const itemId = items.create({ module_id: sourceId, name: 'Alice', prompt: '1girl' })
    for (const enabled of [0, 1]) {
      expect(invoke(IPC_CHANNELS.MODULE_ITEM_UPDATE, { id: itemId, data: { enabled } })).toBe(true)
      expect(items.get(itemId)?.enabled).toBe(enabled)
    }
    for (const data of [{ enabled: 2 }, { enabled: true }, { enabled: 0, owner: 'root' }]) {
      expect(() => invoke(IPC_CHANNELS.MODULE_ITEM_UPDATE, { id: itemId, data })).toThrow()
      expect(items.get(itemId)?.enabled).toBe(1)
    }
    expect(() =>
      invoke(IPC_CHANNELS.MODULE_ITEM_CREATE, {
        module_id: sourceId,
        name: 'Unexpected create field',
        prompt: '1girl',
        enabled: 0
      })
    ).toThrow('Unknown module item field')
    expect(items.list(sourceId)).toHaveLength(1)
  })

  it.each([
    ['invalid JSON', '{'],
    ['wrong envelope', JSON.stringify({ module: [], items: [] })],
    [
      'missing prompt',
      JSON.stringify({ module: { name: 'Bad', type: 'custom' }, items: [{ name: 'Alice' }] })
    ],
    ['invalid type', JSON.stringify({ module: { name: 'Bad', type: 'root' }, items: [] })],
    [
      'invalid item',
      JSON.stringify({
        module: { name: 'Bad', type: 'custom' },
        items: [
          { name: 'First', prompt: 'valid' },
          { name: 'Second', prompt: 42 }
        ]
      })
    ],
    [
      'invalid enabled flag',
      JSON.stringify({
        module: { name: 'Bad', type: 'custom' },
        items: [{ name: 'Alice', prompt: '1girl', enabled: 2 }]
      })
    ],
    [
      'invalid prompt variant content',
      JSON.stringify({
        module: { name: 'Bad', type: 'custom' },
        items: [
          { name: 'Alice', prompt: '1girl', prompt_variants: { alt: { prompt: 42, negative: '' } } }
        ]
      })
    ],
    [
      'invalid prompt variant JSON',
      JSON.stringify({
        module: { name: 'Bad', type: 'custom' },
        items: [{ name: 'Alice', prompt: '1girl', prompt_variants: '{' }]
      })
    ]
  ])('rejects %s before any database mutation', (_label, jsonData) => {
    const createModule = vi.spyOn(modules.constructor.prototype, 'create')
    const before = modules.list()
    expect(invoke(IPC_CHANNELS.MODULE_IMPORT_DATA, { jsonData })).toEqual({
      error: expect.any(String)
    })
    expect(createModule).not.toHaveBeenCalled()
    expect(modules.list()).toEqual(before)
    createModule.mockRestore()
  })

  it.each(['INSERT', 'UPDATE OF enabled'])(
    'rolls back the module and earlier items when a later %s fails',
    (operation) => {
      database.getDatabase().run(`CREATE TRIGGER reject_import BEFORE ${operation} ON module_items
      WHEN NEW.name = 'Rejected' BEGIN SELECT RAISE(ABORT, 'Rejected by test'); END`)
      const before = modules.list()
      const result = invoke(IPC_CHANNELS.MODULE_IMPORT_DATA, {
        jsonData: JSON.stringify({
          module: { name: 'Failed import', type: 'custom' },
          items: [
            { name: 'First', prompt: 'valid' },
            { name: 'Rejected', prompt: 'valid', enabled: 0 }
          ]
        })
      })
      expect(result).toEqual({ error: 'Rejected by test' })
      expect(modules.list()).toEqual(before)
      expect(database.getDatabase().exec('SELECT COUNT(*) FROM module_items')[0].values).toEqual([
        [0]
      ])
    }
  )
})
