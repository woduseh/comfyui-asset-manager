import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { FakeComfyUIServer, deferred } from '../../../helpers/fake-comfyui'

const state = vi.hoisted(() => ({ directory: '', manager: null as unknown }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/comfyui/manager', () => ({
  get comfyuiManager() {
    return state.manager
  }
}))
vi.mock('@main/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/constants')>()),
  TASK_EXECUTION_TIMEOUT_MS: 3000,
  COMPLETION_POLL_INTERVAL_MS: 5,
  PAUSE_CHECK_INTERVAL_MS: 5
}))
let server: FakeComfyUIServer
let db: typeof import('@main/services/database')
let repos: typeof import('@main/services/database/repositories')
let client: import('@main/services/comfyui/client').ComfyUIClient
let ws: import('@main/services/comfyui/websocket').ComfyUIWebSocket
let queue: typeof import('@main/services/batch/queue-manager').queueManager
let directory: string
let jobId: string
let taskId: string

beforeEach(async () => {
  vi.resetModules()
  directory = mkdtempSync(join(tmpdir(), 'comfy-fault-'))
  state.directory = directory
  server = await FakeComfyUIServer.start()
  const { ComfyUIClient } = await import('@main/services/comfyui/client')
  const { ComfyUIWebSocket } = await import('@main/services/comfyui/websocket')
  client = new ComfyUIClient(server.host, server.port)
  ws = new ComfyUIWebSocket(server.host, server.port)
  ws.on('error', () => {})
  state.manager = { restClient: client, webSocket: ws, isConnected: true, clientId: ws.clientId }
  db = await import('@main/services/database')
  await db.initDatabase()
  repos = await import('@main/services/database/repositories')
  queue = (await import('@main/services/batch/queue-manager')).queueManager
  const workflowId = new repos.WorkflowRepository().create({
    name: 'Test',
    category: 'generation',
    api_json: '{}'
  })
  jobId = new repos.BatchJobRepository().create({
    name: 'Fault',
    workflow_id: workflowId,
    total_tasks: 1,
    config: JSON.stringify({
      name: 'Fault',
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
  const settings = new repos.SettingsRepository()
  settings.set('output_directory', join(directory, 'output'))
  settings.set('max_retries', '1')
  await db.flushDatabase()
})
afterEach(async () => {
  ws.disconnect()
  await server.close()
  vi.restoreAllMocks()
  await db.closeDatabase()
  if (!directory.startsWith(join(tmpdir(), 'comfy-fault-'))) throw new Error('Unsafe cleanup')
  rmSync(directory, { recursive: true, force: true })
})
function task(): Record<string, unknown> {
  return new repos.BatchTaskRepository().listByJob(jobId)[0]
}
function images(): unknown[][] {
  return db.getDatabase().exec('SELECT file_path FROM generated_images')[0]?.values ?? []
}
function outputFiles(): string[] {
  try {
    return readdirSync(join(directory, 'output', 'results'))
  } catch {
    return []
  }
}
async function restartQueue(): Promise<void> {
  await db.closeDatabase()
  vi.resetModules()
  db = await import('@main/services/database')
  await db.initDatabase()
  repos = await import('@main/services/database/repositories')
  queue = (await import('@main/services/batch/queue-manager')).queueManager
  await queue.recoverInterruptedJobs()
}
describe('batch fault boundaries with a real loopback ComfyUI server', () => {
  it('does not resubmit an accepted prompt whose HTTP response was lost', async () => {
    server.onPrompt = () => 'drop'
    await queue.startJob(jobId)
    expect(server.accepted).toHaveLength(1)
    expect(task().status).toBe('uncertain')
    expect(new repos.BatchJobRepository().get(jobId)?.status).toBe('paused')
    expect(queue.preflightStart(jobId).success).toBe(false)
    expect(images()).toEqual([])
  })
  it('finds history when completion arrived before POST returned', async () => {
    ws.connect()
    await once(ws, 'connected')
    server.onPrompt = async ({ id }) => {
      const seen = once(ws, 'executionComplete')
      server.complete(id)
      await seen
    }
    await queue.startJob(jobId)
    expect(task().status).toBe('completed')
    expect(server.accepted).toHaveLength(1)
    expect(images()).toHaveLength(1)
  })
  it('retries failed image downloads against the original prompt without regenerating', async () => {
    server.failedImages.add('second.png')
    server.onPrompt = ({ id }) => {
      server.complete(id, ['first.png', 'second.png'])
    }
    await queue.startJob(jobId)
    expect(server.accepted).toHaveLength(1)
    expect(task().status).toBe('failed')
    expect(images()).toEqual([])
    expect(outputFiles()).toEqual([])
    expect(server.history.has(server.accepted[0].id)).toBe(true)
  })
  it('does not commit image downloads that complete after cancellation', async () => {
    const requested = deferred()
    const release = deferred()
    server.onPrompt = ({ id }) => {
      server.complete(id)
    }
    server.onImage = async () => {
      requested.resolve()
      await release.promise
    }
    const run = queue.startJob(jobId)
    await requested.promise
    queue.cancel(jobId)
    release.resolve()
    await run
    expect(task().status).not.toBe('completed')
    expect(images()).toEqual([])
    expect(outputFiles()).toEqual([])
    expect(server.interrupts).toBe(0)
  })
  it('restores the persisted prompt id instead of resetting an interrupted request', async () => {
    const result = await client.queuePrompt({}, ws.clientId)
    server.complete(result.prompt_id)
    new repos.BatchTaskRepository().updateStatus(taskId, 'running', {
      comfyui_prompt_id: result.prompt_id
    })
    new repos.BatchJobRepository().updateStatus(jobId, 'paused')
    await db.flushDatabase()
    await db.closeDatabase()
    await db.initDatabase()
    await queue.recoverInterruptedJobs()
    expect(task().comfyui_prompt_id).toBe(result.prompt_id)
    await queue.startJob(jobId)
    expect(server.accepted).toHaveLength(1)
    expect(task().status).toBe('completed')
  })

  it('finishes the in-flight task while paused and submits the next task only after resume', async () => {
    db.getDatabase().run('UPDATE batch_jobs SET total_tasks = 2 WHERE id = ?', [jobId])
    new repos.BatchTaskRepository().createSingle({
      job_id: jobId,
      prompt_data: String(task().prompt_data),
      metadata: String(task().metadata),
      sort_order: 1
    })
    const requested = deferred()
    const release = deferred()
    let downloads = 0
    server.onImage = async () => {
      if (++downloads === 1) {
        requested.resolve()
        await release.promise
      }
    }
    server.onPrompt = ({ id }) => {
      server.complete(id)
    }
    const run = queue.startJob(jobId)
    await requested.promise
    queue.pause()
    release.resolve()
    await vi.waitFor(() => expect(task().status).toBe('completed'))
    expect(new repos.BatchJobRepository().get(jobId)?.status).toBe('paused')
    expect(server.accepted).toHaveLength(1)
    await queue.resume(jobId)
    await run
    expect(server.accepted).toHaveLength(2)
    expect(images()).toHaveLength(2)
    expect(new repos.BatchJobRepository().get(jobId)?.status).toBe('completed')
  })

  it('coalesces duplicate and delayed completion events and survives socket loss without duplicate output', async () => {
    ws.connect()
    await once(ws, 'connected')
    const requested = deferred()
    const release = deferred()
    server.onHistory = async () => {
      requested.resolve()
      await release.promise
    }
    const run = queue.startJob(jobId)
    const accepted = await server.waitForPrompt()
    await requested.promise
    server.send({ type: 'executing', data: { prompt_id: 'previous-prompt', node: null } })
    server.complete(accepted.id)
    server.complete(accepted.id)
    const disconnected = once(ws, 'disconnected')
    server.disconnectClients()
    await disconnected
    release.resolve()
    await run
    expect(task().status).toBe('completed')
    expect(server.accepted).toHaveLength(1)
    expect(images()).toHaveLength(1)
    expect(outputFiles()).toHaveLength(1)
    expect(ws.listenerCount('executionComplete')).toBe(0)
  })

  it('recovers a persisted submitting intent as uncertain and never resends it', async () => {
    const accepted = await client.queuePrompt({}, ws.clientId)
    new repos.BatchTaskRepository().updateStatus(taskId, 'submitting')
    new repos.BatchJobRepository().updateStatus(jobId, 'running')
    await db.flushDatabase()
    await db.closeDatabase()
    await db.initDatabase()
    await queue.recoverInterruptedJobs()
    expect(task().status).toBe('uncertain')
    expect(task().comfyui_prompt_id).toBeNull()
    expect(new repos.BatchJobRepository().get(jobId)?.status).toBe('paused')
    await expect(queue.startJob(jobId)).rejects.toThrow(/reconciliation/i)
    expect(server.accepted.map((prompt) => prompt.id)).toEqual([accepted.prompt_id])
    expect(images()).toEqual([])
  })

  it('reuses persisted lazy task identity and random seed while expanding only the missing tail', async () => {
    const job = new repos.BatchJobRepository().get(jobId)!
    const config = JSON.parse(String(job.config)) as Record<string, unknown>
    config.seedMode = 'random'
    config.countPerCombination = 2
    config.moduleSelections = [{ moduleId: 'module', selectedItemIds: ['item'] }]
    const snapshot = [
      {
        moduleId: 'module',
        moduleType: 'character',
        items: [
          { id: 'item', name: 'Character', prompt: 'test', negative: '', weight: 1, enabled: true }
        ]
      }
    ]
    db.getDatabase().run(
      'UPDATE batch_jobs SET config = ?, module_data_snapshot = ?, total_tasks = 2, status = ? WHERE id = ?',
      [JSON.stringify(config), JSON.stringify(snapshot), 'running', jobId]
    )
    db.getDatabase().run('UPDATE workflows SET api_json = ? WHERE id = ?', [
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: { seed: 999 } } }),
      String(job.workflow_id)
    ])
    await db.flushDatabase()
    await db.closeDatabase()
    await db.initDatabase()
    await queue.recoverInterruptedJobs()
    server.onPrompt = ({ id }) => {
      server.complete(id)
    }
    await queue.startJob(jobId)
    const tasks = new repos.BatchTaskRepository().listByJob(jobId)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].id).toBe(taskId)
    expect(tasks.map((value) => value.sort_order)).toEqual([0, 1])
    expect(tasks.every((value) => value.status === 'completed')).toBe(true)
    expect(server.accepted).toHaveLength(2)
    expect(server.accepted[0].body.prompt['1'].inputs.seed).toBe(0)
    expect(images()).toHaveLength(2)
  })

  it('resumes a known server request after shutdown during completion wait', async () => {
    const waiting = deferred()
    server.onHistory = () => {
      waiting.resolve()
    }
    const run = queue.startJob(jobId)
    await waiting.promise
    const acceptedId = server.accepted[0].id
    await queue.shutdown()
    await run
    expect(task().status).toBe('pending')
    expect(task().comfyui_prompt_id).toBe(acceptedId)
    expect(new repos.BatchJobRepository().get(jobId)?.status).toBe('paused')
    await restartQueue()
    server.complete(acceptedId)
    await queue.startJob(jobId)
    expect(task().status).toBe('completed')
    expect(server.accepted).toHaveLength(1)
    expect(images()).toHaveLength(1)
  })

  it('retains files and the journal when the completed DB snapshot cannot be persisted', async () => {
    const originalFlush = db.flushDatabase
    let injected = false
    vi.spyOn(db, 'flushDatabase').mockImplementation(async () => {
      if (!injected && images().length > 0) {
        injected = true
        throw new Error('Injected completed snapshot failure')
      }
      await originalFlush()
    })
    server.onPrompt = ({ id }) => {
      server.complete(id)
    }
    await queue.startJob(jobId)
    expect(injected).toBe(true)
    expect(task().status).toBe('uncertain')
    expect(images()).toHaveLength(1)
    expect(outputFiles()).toHaveLength(1)
    expect(readdirSync(join(directory, 'data', 'task-output-journals'))).toHaveLength(1)
    expect(server.history.has(server.accepted[0].id)).toBe(true)
    expect(queue.isProcessing).toBe(false)
    vi.restoreAllMocks()
    await restartQueue()
    await expect(queue.startJob(jobId)).rejects.toThrow(/reconciliation/i)
    expect(server.accepted).toHaveLength(1)
    expect(images()).toHaveLength(1)
    expect(outputFiles()).toHaveLength(1)
  })

  it('counts one retry durably when history confirms the first execution failed', async () => {
    server.onPrompt = ({ id }) => {
      server.complete(id)
      if (server.accepted.length === 1) {
        server.history.get(id)!.status = { status_str: 'error', completed: false }
      }
    }
    await queue.startJob(jobId)
    expect(server.accepted).toHaveLength(2)
    expect(task().status).toBe('completed')
    expect(task().retry_count).toBe(1)
    await restartQueue()
    expect(task().retry_count).toBe(1)
    expect(images()).toHaveLength(1)
  })
})
