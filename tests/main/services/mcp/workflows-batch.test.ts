import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const mocks = vi.hoisted(() => ({
  workflowGet: vi.fn(() => ({ id: 'workflow-id' })),
  moduleItemList: vi.fn(() => [{ id: 'item-id' }]),
  createBatch: vi.fn(() => ({ jobId: 'job-id', totalTasks: 3 })),
  requestStart: vi.fn(() => ({ success: true })),
  batchList: vi.fn(() => []),
  batchGet: vi.fn(() => null),
  taskList: vi.fn(() => [])
}))

vi.mock('../../../../src/main/services/mcp/tools/shared', () => ({
  moduleItemRepo: { list: mocks.moduleItemList },
  workflowRepo: { list: vi.fn(() => []), get: mocks.workflowGet, getVariables: vi.fn(() => []) },
  batchJobRepo: { list: mocks.batchList, get: mocks.batchGet },
  batchTaskRepo: { listByJob: mocks.taskList }
}))

vi.mock('../../../../src/main/services/batch/batch-job-service', () => ({
  batchJobService: { create: mocks.createBatch }
}))

vi.mock('../../../../src/main/services/batch/queue-manager', () => ({
  queueManager: { requestStart: mocks.requestStart }
}))

import { registerWorkflowAndBatchTools } from '../../../../src/main/services/mcp/tools/workflows-batch'

type ToolResult = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

function registerTools(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    tool: (...args: unknown[]) => {
      const [name, , , handler] = args as [string, string, unknown, ToolHandler]
      handlers.set(name, handler)
    }
  } as unknown as McpServer
  registerWorkflowAndBatchTools(server)
  return handlers
}

describe('MCP workflow and batch tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates jobs through the shared lazy batch service', async () => {
    const result = await registerTools().get('create_batch_job')!({
      name: 'Batch',
      workflow_id: 'workflow-id',
      module_selections: [{ moduleId: 'module-id', moduleType: 'character' }],
      count_per_combination: 3,
      seed_mode: 'random'
    })

    expect(mocks.createBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-id',
        moduleSelections: [
          expect.objectContaining({ moduleId: 'module-id', selectedItemIds: ['item-id'] })
        ]
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      jobId: 'job-id',
      totalTasks: 3,
      name: 'Batch'
    })
  })

  it('acknowledges start after synchronous preflight without awaiting execution', async () => {
    const result = await registerTools().get('start_batch_job')!({ job_id: 'job-id' })

    expect(mocks.requestStart).toHaveBeenCalledWith('job-id')
    expect(JSON.parse(result.content[0].text)).toEqual({ success: true, job_id: 'job-id' })
  })

  it('returns preflight start failures as MCP errors', async () => {
    mocks.requestStart.mockReturnValueOnce({ success: false, error: 'Not connected' })

    const result = await registerTools().get('start_batch_job')!({ job_id: 'job-id' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Not connected')
  })
})
