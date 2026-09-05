import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const environment = vi.hoisted(() => ({ userDataPath: '', getObjectInfo: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => environment.userDataPath } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../../../src/main/services/comfyui/manager', () => ({
  comfyuiManager: { isConnected: true, restClient: { getObjectInfo: environment.getObjectInfo } }
}))

import {
  closeDatabase,
  flushDatabase,
  getDatabase,
  initDatabase
} from '../../../../src/main/services/database'
import { workflowRepo } from '../../../../src/main/services/mcp/tools/shared'
import { withToolContracts } from '../../../../src/main/services/mcp/tools/tool-contract'
import { registerWorkflowPreparationTools } from '../../../../src/main/services/mcp/tools/workflow-preparation'

let server: McpServer
let client: Client
let directory = ''
const content = JSON.stringify({
  '1': { class_type: 'CustomImage', inputs: { prompt: 'original prompt' } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'preview' } }
})

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'comfyui-workflow-preparation-'))
  environment.userDataPath = directory
  await initDatabase()
  environment.getObjectInfo.mockResolvedValue({
    CustomImage: { input: { required: { prompt: ['STRING'] } }, output: ['IMAGE'] },
    SaveImage: {
      input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } },
      output: [],
      output_node: true
    }
  })
  server = new McpServer({ name: 'preparation-persistence-server', version: '1.0.0' })
  client = new Client({ name: 'preparation-persistence-client', version: '1.0.0' })
  registerWorkflowPreparationTools(withToolContracts(server))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await client.close()
  await server.close()
  await closeDatabase()
  const resolved = resolve(directory)
  const relativePath = relative(resolve(tmpdir()), resolved)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    !basename(resolved).startsWith('comfyui-workflow-preparation-')
  ) {
    throw new Error(`Refusing to remove non-temporary directory: ${resolved}`)
  }
  rmSync(resolved, { recursive: true, force: true })
})

describe('prepare_workflow persistence with a real temporary database and MCP SDK', () => {
  it('durably stores the prepared graph and reviewed variable roles', async () => {
    const args = {
      name: 'Persisted graph',
      source: { kind: 'api_json', content },
      roles: [{ node_id: '1', field: 'prompt', role: 'prompt_positive' }]
    }
    const preview = await client.callTool({ name: 'prepare_workflow', arguments: args })
    expect(workflowRepo.list()).toHaveLength(0)
    const saved = await client.callTool({
      name: 'prepare_workflow',
      arguments: {
        ...args,
        dry_run: false,
        preparation_token: (preview.structuredContent as Record<string, unknown>).preparation_token
      }
    })
    expect(saved.isError).not.toBe(true)
    const id = (saved.structuredContent as Record<string, unknown>).workflow_id as string
    expect(workflowRepo.get(id)).toMatchObject({ name: 'Persisted graph', api_json: content })
    expect(workflowRepo.getVariables(id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node_id: '1', field_name: 'prompt', role: 'prompt_positive' })
      ])
    )
    await closeDatabase()
    await initDatabase()
    expect(workflowRepo.get(id)).toMatchObject({ name: 'Persisted graph', api_json: content })
    expect(workflowRepo.getVariables(id)).toHaveLength(2)
  })

  it('rolls back a new clone and inserted variables on failure while preserving the source', async () => {
    const sourceId = workflowRepo.create({ name: 'Source', category: 'custom', api_json: content })
    workflowRepo.setVariables(sourceId, [
      {
        node_id: '1',
        field_name: 'prompt',
        display_name: 'Prompt',
        var_type: 'text',
        default_val: 'original prompt',
        role: 'prompt_positive'
      }
    ])
    await flushDatabase()
    const originalVariables = workflowRepo.getVariables(sourceId)
    const args = {
      name: 'Clone',
      source: { kind: 'saved_workflow', workflow_id: sourceId },
      input_updates: [{ node_id: '1', field: 'prompt', value: 'clone prompt' }]
    }
    const preview = await client.callTool({ name: 'prepare_workflow', arguments: args })
    const originalSetVariables = workflowRepo.setVariables.bind(workflowRepo)
    vi.spyOn(workflowRepo, 'setVariables').mockImplementationOnce((id, variables) => {
      originalSetVariables(id, variables)
      throw new Error('Failed after variable insert')
    })
    const failed = await client.callTool({
      name: 'prepare_workflow',
      arguments: {
        ...args,
        dry_run: false,
        preparation_token: (preview.structuredContent as Record<string, unknown>).preparation_token
      }
    })
    expect(failed.isError).toBe(true)
    expect((failed.structuredContent as Record<string, unknown>).error).toContain(
      'Failed after variable insert'
    )
    expect(workflowRepo.list()).toHaveLength(1)
    expect(workflowRepo.get(sourceId)).toMatchObject({ name: 'Source', api_json: content })
    expect(workflowRepo.getVariables(sourceId)).toEqual(originalVariables)
    expect(getDatabase().exec('SELECT count(*) FROM workflow_variables')[0].values[0][0]).toBe(1)
    await closeDatabase()
    await initDatabase()
    expect(workflowRepo.list()).toHaveLength(1)
    expect(workflowRepo.getVariables(sourceId)).toEqual(originalVariables)
  })
})
