import { describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const repositoryMocks = vi.hoisted(() => ({
  moduleList: vi.fn(() => [{ id: 'module-id', name: 'Characters' }]),
  moduleGet: vi.fn(() => ({ id: 'module-id', name: 'Characters' })),
  moduleCreate: vi.fn(() => 'created-id'),
  moduleUpdate: vi.fn(),
  moduleDelete: vi.fn(),
  itemList: vi.fn(() => [{ id: 'item-id', name: 'Alice' }])
}))

vi.mock('../../../../src/main/services/database/repositories', () => ({
  ModuleRepository: class {
    list = repositoryMocks.moduleList
    get = repositoryMocks.moduleGet
    create = repositoryMocks.moduleCreate
    update = repositoryMocks.moduleUpdate
    delete = repositoryMocks.moduleDelete
  },
  ModuleItemRepository: class {
    list = repositoryMocks.itemList
  },
  WorkflowRepository: class {},
  BatchJobRepository: class {},
  BatchTaskRepository: class {}
}))

import { registerModuleCoreTools } from '../../../../src/main/services/mcp/tools/modules'

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>
  isError?: boolean
}>

function registerTools(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    tool: (...args: unknown[]) => {
      const [name, , , handler] = args as [string, string, unknown, ToolHandler]
      handlers.set(name, handler)
    }
  } as unknown as McpServer
  registerModuleCoreTools(server)
  return handlers
}

describe('MCP module tools', () => {
  it('lists modules with the requested filter', async () => {
    const result = await registerTools().get('list_modules')!({ type: 'character' })

    expect(repositoryMocks.moduleList).toHaveBeenCalledWith('character')
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'module-id', name: 'Characters' }])
  })

  it('returns a module together with its items', async () => {
    const result = await registerTools().get('get_module')!({ id: 'module-id' })

    expect(repositoryMocks.moduleGet).toHaveBeenCalledWith('module-id')
    expect(repositoryMocks.itemList).toHaveBeenCalledWith('module-id')
    expect(JSON.parse(result.content[0].text)).toEqual({
      module: { id: 'module-id', name: 'Characters' },
      items: [{ id: 'item-id', name: 'Alice' }]
    })
  })

  it('reports missing modules without listing items', async () => {
    repositoryMocks.moduleGet.mockReturnValueOnce(null as never)

    const result = await registerTools().get('get_module')!({ id: 'missing' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('missing')
  })

  it('creates, updates, and deletes modules through repositories', async () => {
    const tools = registerTools()

    const created = await tools.get('create_module')!({
      name: 'Styles',
      type: 'style',
      description: 'Styles'
    })
    await tools.get('update_module')!({ id: 'created-id', name: 'Updated' })
    await tools.get('update_module')!({ id: 'created-id', description: 'Updated description' })
    await tools.get('delete_module')!({ id: 'created-id' })

    expect(repositoryMocks.moduleCreate).toHaveBeenCalledWith({
      name: 'Styles',
      type: 'style',
      description: 'Styles'
    })
    expect(JSON.parse(created.content[0].text)).toMatchObject({ id: 'created-id' })
    expect(repositoryMocks.moduleUpdate).toHaveBeenCalledWith('created-id', { name: 'Updated' })
    expect(repositoryMocks.moduleUpdate).toHaveBeenCalledWith('created-id', {
      description: 'Updated description'
    })
    expect(repositoryMocks.moduleDelete).toHaveBeenCalledWith('created-id')
  })
})
