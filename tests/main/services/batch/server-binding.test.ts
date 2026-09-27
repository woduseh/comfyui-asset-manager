import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeComfyUIServer, deferred } from '../../../helpers/fake-comfyui'
import { openTestDatabase, type TestDatabase } from '../../../helpers/database'

const state = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.path },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

let fixture: TestDatabase
let source: FakeComfyUIServer
let other: FakeComfyUIServer
let manager: typeof import('@main/services/comfyui/manager').comfyuiManager
let queue: typeof import('@main/services/batch/queue-manager').queueManager
let repos: typeof import('@main/services/database/repositories')
let jobId: string
let taskId: string

beforeEach(async () => {
  vi.resetModules()
  fixture = await openTestDatabase((path) => {
    state.path = path
  })
  source = await FakeComfyUIServer.start()
  other = await FakeComfyUIServer.start()
  manager = (await import('@main/services/comfyui/manager')).comfyuiManager
  queue = (await import('@main/services/batch/queue-manager')).queueManager
  repos = await import('@main/services/database/repositories')
  const connected = once(manager.webSocket, 'connected')
  await manager.connect(source.host, source.port)
  await connected
  const workflowId = new repos.WorkflowRepository().create({
    name: 'Server binding',
    api_json: '{}',
    category: 'generation'
  })
  jobId = new repos.BatchJobRepository().create({
    name: 'Bound job',
    workflow_id: workflowId,
    total_tasks: 1,
    config: JSON.stringify({
      name: 'Bound job',
      workflowId,
      moduleSelections: [],
      countPerCombination: 1,
      seedMode: 'fixed',
      fixedSeed: 0,
      outputFolderPattern: 'results',
      fileNamePattern: 'image'
    })
  })
  taskId = new repos.BatchTaskRepository().createSingle({
    job_id: jobId,
    prompt_data: JSON.stringify({ positive: 'test', negative: '', seed: 0, extraVariables: {} }),
    metadata: JSON.stringify({ combinationIndex: 0, imageIndex: 0, totalInCombination: 1 }),
    sort_order: 0
  })
  new repos.SettingsRepository().set('output_directory', join(fixture.directory, 'output'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  manager.disconnect()
  await source.close()
  await other.close()
  await fixture.close()
})

describe('ComfyUI execution server binding', () => {
  it('rejects another server after disconnect, allows same-server recovery and saves only source outputs', async () => {
    const requested = deferred(),
      release = deferred()
    source.onPrompt = (prompt) => {
      source.images.set('image.png', Buffer.from('SOURCE_A'))
      source.complete(prompt.id)
    }
    source.onHistory = async () => {
      requested.resolve()
      await release.promise
    }
    other.images.set('image.png', Buffer.from('OTHER_B'))
    const run = queue.startJob(jobId)
    try {
      await requested.promise
      expect(new repos.BatchTaskRepository().get(taskId)?.comfyui_server_url).toBe(
        `http://${source.host}:${source.port}`
      )
      manager.disconnect()
      await expect(manager.connect(other.host, other.port)).rejects.toThrow('Cannot change')
      const connected = once(manager.webSocket, 'connected')
      expect(await manager.connect(source.host, source.port)).toBe(true)
      await connected
    } finally {
      release.resolve()
      await run
    }
    expect(new repos.BatchJobRepository().get(jobId)?.status).toBe('completed')
    const image = new repos.GeneratedImageRepository().list({ page: 1, pageSize: 10 }).items[0]
    expect(readFileSync(String(image.file_path), 'utf8')).toBe('SOURCE_A')
    expect(other.requests).toEqual([])
    expect(source.history.size).toBe(0)
    expect(await manager.connect(other.host, other.port)).toBe(true)
  })

  it.each(['different', 'unknown'] as const)(
    'does not query or resubmit a persisted request from a %s server after reopening',
    async (mode) => {
      const accepted = await manager.restClient.queuePrompt({})
      source.complete(accepted.prompt_id)
      new repos.BatchTaskRepository().updateStatus(taskId, 'running', {
        comfyui_prompt_id: accepted.prompt_id,
        ...(mode === 'different' ? { comfyui_server_url: manager.restClient.serverUrl } : {})
      })
      new repos.BatchJobRepository().updateStatus(jobId, 'running')
      await fixture.database.closeDatabase()
      fixture.db = await fixture.database.initDatabase()
      await queue.recoverInterruptedJobs()
      await manager.connect(other.host, other.port)
      const before = other.requests.length
      const check = queue.preflightStart(jobId)
      expect(check.success).toBe(false)
      expect(check.error).toContain(
        mode === 'different' ? 'original ComfyUI server' : 'legacy accepted request'
      )
      await expect(queue.startJob(jobId)).rejects.toThrow()
      expect(other.requests).toHaveLength(before)
      expect(new repos.BatchTaskRepository().get(taskId)?.comfyui_prompt_id).toBe(
        accepted.prompt_id
      )
      if (mode === 'different') {
        await manager.connect(source.host, source.port)
        await queue.startJob(jobId)
        expect(source.accepted).toHaveLength(1)
        expect(new repos.BatchTaskRepository().get(taskId)?.status).toBe('completed')
      }
    }
  )

  it('checks the lease again after a connection probe and ignores probes superseded by disconnect', async () => {
    const { ComfyUIClient } = await import('@main/services/comfyui/client')
    const pending = deferred<boolean>()
    vi.spyOn(ComfyUIClient.prototype, 'ping').mockReturnValueOnce(pending.promise)
    const attempt = manager.connect(other.host, other.port)
    const execution = manager.acquireExecution()
    try {
      pending.resolve(true)
      await expect(attempt).rejects.toThrow('Cannot change')
      expect(manager.restClient.serverUrl).toBe(execution.serverUrl)
    } finally {
      execution.release()
    }
    const stale = deferred<boolean>()
    vi.mocked(ComfyUIClient.prototype.ping).mockReturnValueOnce(stale.promise)
    const cancelled = manager.connect(other.host, other.port)
    manager.disconnect()
    stale.resolve(true)
    expect(await cancelled).toBe(false)
    expect(manager.isConnected).toBe(false)
  })
})
