import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  queue: {
    isProcessing: false,
    isPaused: false,
    currentJobId: null as string | null,
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    preflightStart: vi.fn()
  },
  comfy: { isConnected: false, connect: vi.fn() },
  settings: vi.fn(),
  status: vi.fn()
}))
vi.mock('../../../../src/main/services/batch/queue-manager', () => ({ queueManager: mocks.queue }))
vi.mock('../../../../src/main/services/comfyui/manager', () => ({ comfyuiManager: mocks.comfy }))
vi.mock('../../../../src/main/services/database/repositories', () => ({
  SettingsRepository: class {
    get = mocks.settings
  }
}))
vi.mock('../../../../src/main/services/mcp/tools/workflows-batch', () => ({
  batchStatus: mocks.status
}))

import { registerExecutionTools } from '../../../../src/main/services/mcp/tools/execution'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
const registered = new Map<string, { schema: z.ZodObject<z.ZodRawShape>; handler: Handler }>()
registerExecutionTools({
  tool: (name: string, _description: string, schema: z.ZodRawShape, handler: Handler) => {
    registered.set(name, { schema: z.object(schema), handler })
  }
} as unknown as McpServer)

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  const tool = registered.get(name)!
  return tool.handler(tool.schema.parse(args))
}

function status(value = 'running', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job: { id: 'job', status: value },
    counts: { running: 1 },
    terminal: false,
    requires_review: false,
    execution_active: true,
    ...extra
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.queue, { isProcessing: false, isPaused: false, currentJobId: null })
  mocks.comfy.isConnected = false
  mocks.comfy.connect.mockResolvedValue(true)
  mocks.settings.mockImplementation((key: string) =>
    key === 'comfyui_host' ? 'configured-host' : '8189'
  )
  mocks.status.mockReturnValue(status())
  mocks.queue.resume.mockResolvedValue(undefined)
  mocks.queue.preflightStart.mockReturnValue({ success: false, error: 'Not connected' })
})

describe('MCP execution tools', () => {
  it('returns connection, queue and explicit job preflight', async () => {
    const result = await call('get_execution_status', { job_id: 'job' })
    expect(result.structuredContent).toMatchObject({
      connected: false,
      queue: { processing: false },
      start_preflight: { success: false, error: 'Not connected' }
    })
    expect(mocks.status).toHaveBeenCalledWith('job')
  })

  it('connects only using saved settings', async () => {
    const result = await call('connect_comfyui', { host: 'untrusted-host', port: 1 })
    expect(result.isError).not.toBe(true)
    expect(mocks.comfy.connect).toHaveBeenCalledWith('configured-host', 8189)
  })

  it('rejects reconnect while processing and reports connection failure', async () => {
    mocks.queue.isProcessing = true
    expect((await call('connect_comfyui')).isError).toBe(true)
    expect(mocks.comfy.connect).not.toHaveBeenCalled()
    mocks.queue.isProcessing = false
    mocks.comfy.connect.mockResolvedValue(false)
    expect((await call('connect_comfyui')).isError).toBe(true)
  })

  it.each(['pause', 'resume', 'cancel'])(
    'rejects control of another job for %s',
    async (action) => {
      Object.assign(mocks.queue, { isProcessing: true, currentJobId: 'other' })
      expect((await call('control_batch_job', { job_id: 'job', action })).isError).toBe(true)
      expect(mocks.queue.pause).not.toHaveBeenCalled()
      expect(mocks.queue.resume).not.toHaveBeenCalled()
      expect(mocks.queue.cancel).not.toHaveBeenCalled()
    }
  )

  it('pauses the active job and resumes an explicitly selected cold paused job', async () => {
    Object.assign(mocks.queue, { isProcessing: true, currentJobId: 'job' })
    expect((await call('control_batch_job', { job_id: 'job', action: 'pause' })).isError).not.toBe(
      true
    )
    expect(mocks.queue.pause).toHaveBeenCalledOnce()
    Object.assign(mocks.queue, { isProcessing: false, currentJobId: null })
    mocks.status.mockReturnValue(status('paused'))
    expect((await call('control_batch_job', { job_id: 'job', action: 'resume' })).isError).not.toBe(
      true
    )
    expect(mocks.queue.resume).toHaveBeenCalledWith('job')
  })

  it('reports uncertain outcome resume refusal without invoking another operation', async () => {
    mocks.status.mockReturnValue(status('paused', { requires_review: true }))
    mocks.queue.resume.mockRejectedValue(
      new Error('Task outcome requires reconciliation before resuming')
    )
    const result = await call('control_batch_job', { job_id: 'job', action: 'resume' })
    expect(result.isError).toBe(true)
    expect(mocks.queue.cancel).not.toHaveBeenCalled()
  })

  it('cancels through the queue contract and retains its execution-active response', async () => {
    Object.assign(mocks.queue, { isProcessing: true, currentJobId: 'job' })
    mocks.status.mockReturnValueOnce(status()).mockReturnValue(status('cancelled'))
    const result = await call('control_batch_job', { job_id: 'job', action: 'cancel' })
    expect(mocks.queue.cancel).toHaveBeenCalledWith('job')
    expect(result.structuredContent).toMatchObject({
      cancel_requested: true,
      execution_active: true
    })
  })

  it('keeps pause and cancel no-ops idempotent and refuses invalid source states', async () => {
    mocks.status.mockReturnValue(status('paused', { execution_active: false }))
    const paused = await call('control_batch_job', { job_id: 'job', action: 'pause' })
    expect(paused.structuredContent).toMatchObject({ action: 'pause', already_paused: true })
    mocks.status.mockReturnValue(status('cancelled', { execution_active: false }))
    const cancelled = await call('control_batch_job', { job_id: 'job', action: 'cancel' })
    expect(cancelled.structuredContent).toMatchObject({ action: 'cancel', already_cancelled: true })
    mocks.status.mockReturnValue(status('draft', { execution_active: false }))
    for (const action of ['pause', 'resume', 'cancel']) {
      expect((await call('control_batch_job', { job_id: 'job', action })).isError).toBe(true)
    }
    expect(mocks.queue.pause).not.toHaveBeenCalled()
    expect(mocks.queue.resume).not.toHaveBeenCalled()
    expect(mocks.queue.cancel).not.toHaveBeenCalled()
  })

  it('requires an explicit supported control action and removes legacy aliases', async () => {
    await expect(call('control_batch_job', { job_id: 'job' })).rejects.toThrow()
    await expect(call('control_batch_job', { job_id: 'job', action: 'restart' })).rejects.toThrow()
    for (const name of ['pause_batch_job', 'resume_batch_job', 'cancel_batch_job']) {
      expect(registered.has(name)).toBe(false)
    }
  })

  it.each(['paused', 'completed'])('returns %s immediately from wait', async (value) => {
    mocks.status.mockReturnValue(status(value, { terminal: value === 'completed' }))
    const result = await call('wait_batch_job', { job_id: 'job' })
    expect(result.structuredContent).toMatchObject({ timed_out: false, changed: false })
    expect(mocks.status).toHaveBeenCalledOnce()
  })

  it('supports a no-wait snapshot and cursor-based changes without mutation', async () => {
    const initial = await call('wait_batch_job', { job_id: 'job', timeout_ms: 0 })
    expect(initial.structuredContent).toMatchObject({ timed_out: true })
    mocks.status.mockReturnValue(status('running', { counts: { completed: 1 } }))
    const changed = await call('wait_batch_job', {
      job_id: 'job',
      after: initial.structuredContent!.cursor
    })
    expect(changed.structuredContent).toMatchObject({ changed: true, timed_out: false })
    expect(mocks.queue.resume).not.toHaveBeenCalled()
    expect(mocks.queue.cancel).not.toHaveBeenCalled()
  })

  it('waits only to its requested timeout with bounded reads', async () => {
    const result = await call('wait_batch_job', { job_id: 'job', timeout_ms: 20 })
    expect(result.structuredContent).toMatchObject({ timed_out: true })
    expect(mocks.status.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('enforces explicit IDs and a bounded wait duration', async () => {
    await expect(call('control_batch_job', { action: 'cancel' })).rejects.toThrow()
    await expect(call('wait_batch_job', { job_id: 'job', timeout_ms: 30001 })).rejects.toThrow()
    await expect(call('control_batch_job', { job_id: ' ', action: 'pause' })).rejects.toThrow()
  })
})
