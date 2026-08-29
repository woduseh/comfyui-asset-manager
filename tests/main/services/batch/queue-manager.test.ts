import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let mockDb: SqlJsDatabase

const databaseMocks = vi.hoisted(() => ({
  saveDatabase: vi.fn(),
  setBatchMode: vi.fn()
}))

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(() => [] as Array<Record<string, unknown>>)
}))

vi.mock('../../../../src/main/services/database/index', () => ({
  getDatabase: () => mockDb,
  saveDatabase: databaseMocks.saveDatabase,
  setBatchMode: databaseMocks.setBatchMode,
  withTransaction: <T>(fn: () => T): T => {
    mockDb.run('BEGIN TRANSACTION')
    try {
      const result = fn()
      mockDb.run('COMMIT')
      return result
    } catch (error) {
      mockDb.run('ROLLBACK')
      throw error
    }
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows }
}))

vi.mock('../../../../src/main/services/comfyui/manager', () => ({
  comfyuiManager: {
    isConnected: false,
    clientId: 'test-client',
    restClient: {
      interrupt: vi.fn().mockResolvedValue(undefined),
      queuePrompt: vi.fn(),
      getImage: vi.fn(),
      deleteFromHistory: vi.fn()
    },
    wsClient: null
  }
}))

vi.mock('../../../../src/main/ipc/channels', () => ({
  IPC_CHANNELS: {
    COMFYUI_CONNECTION_CHANGED: 'comfyui:connection-changed',
    QUEUE_PROGRESS: 'queue:progress',
    QUEUE_TASK_COMPLETED: 'queue:task-completed',
    QUEUE_TASK_FAILED: 'queue:task-failed',
    QUEUE_JOB_COMPLETED: 'queue:job-completed',
    QUEUE_STATUS_CHANGED: 'queue:status-changed',
    COMFYUI_PREVIEW: 'comfyui:preview'
  }
}))

vi.mock('../../../../src/main/services/batch/task-generator', () => ({
  resolveOutputPath: vi.fn(),
  expandBatchToTasksChunk: vi.fn()
}))

import {
  SettingsRepository,
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository
} from '../../../../src/main/services/database/repositories/index'

function createTables(db: SqlJsDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  db.run(`CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'generation', api_json TEXT NOT NULL,
    ui_json TEXT, variables TEXT NOT NULL DEFAULT '[]', thumbnail BLOB,
    created_at DATETIME DEFAULT (datetime('now')), updated_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS prompt_modules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, description TEXT DEFAULT '',
    is_template INTEGER DEFAULT 0, parent_id TEXT REFERENCES prompt_modules(id),
    created_at DATETIME DEFAULT (datetime('now')), updated_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS module_items (
    id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES prompt_modules(id) ON DELETE CASCADE,
    name TEXT NOT NULL, prompt TEXT NOT NULL, negative TEXT DEFAULT '', weight REAL DEFAULT 1.0,
    sort_order INTEGER DEFAULT 0, metadata TEXT DEFAULT '{}', thumbnail BLOB, enabled INTEGER DEFAULT 1,
    prompt_variants TEXT DEFAULT '{}'
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', config TEXT NOT NULL, workflow_id TEXT REFERENCES workflows(id),
    total_tasks INTEGER DEFAULT 0, completed_tasks INTEGER DEFAULT 0, failed_tasks INTEGER DEFAULT 0,
    pipeline_config TEXT, created_at DATETIME DEFAULT (datetime('now')),
    started_at DATETIME, completed_at DATETIME, sort_order INTEGER DEFAULT 0,
    module_data_snapshot TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS batch_tasks (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending', prompt_data TEXT NOT NULL, comfyui_prompt_id TEXT,
    result_path TEXT, error_message TEXT, retry_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0, metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT (datetime('now')), completed_at DATETIME
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY, task_id TEXT REFERENCES batch_tasks(id),
    job_id TEXT REFERENCES batch_jobs(id), file_path TEXT NOT NULL,
    thumbnail_path TEXT, file_size INTEGER, width INTEGER, height INTEGER,
    generation_params TEXT DEFAULT '{}', prompt_text TEXT, negative_text TEXT,
    rating INTEGER DEFAULT 0, is_favorite INTEGER DEFAULT 0, tags TEXT DEFAULT '[]',
    character_name TEXT, outfit_name TEXT, emotion_name TEXT, style_name TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_prompt TEXT NOT NULL,
    negative_prompt TEXT DEFAULT '', thumbnail BLOB, metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_batch_tasks_job ON batch_tasks(job_id)`)
  db.run(
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('comfyui_host', 'localhost'), ('comfyui_port', '8188')`
  )
  db.run('PRAGMA foreign_keys = ON;')
}

describe('QueueManager Recovery', () => {
  let jobRepo: BatchJobRepository
  let taskRepo: BatchTaskRepository
  let settingsRepo: SettingsRepository

  beforeEach(async () => {
    const SQL = await initSqlJs()
    mockDb = new SQL.Database()
    createTables(mockDb)
    settingsRepo = new SettingsRepository()
    jobRepo = new BatchJobRepository()
    taskRepo = new BatchTaskRepository()

    const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
    const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
    Object.assign(queueManager, {
      _isProcessing: false,
      _isPaused: false,
      _isCancelled: false,
      _currentJobId: null,
      _maxRetries: 3
    })
    ;(comfyuiManager as { isConnected: boolean }).isConnected = false
    vi.mocked(comfyuiManager.restClient.interrupt).mockReset().mockResolvedValue(undefined)
    databaseMocks.saveDatabase.mockClear()
    databaseMocks.setBatchMode.mockClear()
    electronMocks.getAllWindows.mockReset().mockReturnValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('recoverInterruptedJobs', () => {
    it('converts orphaned running jobs to paused', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Test Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')

      queueManager.recoverInterruptedJobs()

      const job = jobRepo.get(jobId)
      expect(job?.status).toBe('paused')
    })

    it('resets stuck running tasks to pending', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Test Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 2, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')
      taskRepo.updateStatus(tasks[1].id as string, 'running', { comfyui_prompt_id: 'p-1' })
      // tasks[2] stays pending

      queueManager.recoverInterruptedJobs()

      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('pending')
      expect(updated[1].comfyui_prompt_id).toBeNull()
      expect(updated[2].status).toBe('pending')
    })

    it('does not affect completed or cancelled jobs', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const completedId = jobRepo.create({ name: 'Done Job', config: '{}' })
      jobRepo.updateStatus(completedId, 'completed')
      const cancelledId = jobRepo.create({ name: 'Cancelled Job', config: '{}' })
      jobRepo.updateStatus(cancelledId, 'cancelled')

      queueManager.recoverInterruptedJobs()

      expect(jobRepo.get(completedId)?.status).toBe('completed')
      expect(jobRepo.get(cancelledId)?.status).toBe('cancelled')
    })

    it('recovers multiple orphaned running jobs', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const job1 = jobRepo.create({ name: 'Job 1', config: '{}' })
      const job2 = jobRepo.create({ name: 'Job 2', config: '{}' })
      jobRepo.updateStatus(job1, 'running')
      jobRepo.updateStatus(job2, 'running')

      queueManager.recoverInterruptedJobs()

      expect(jobRepo.get(job1)?.status).toBe('paused')
      expect(jobRepo.get(job2)?.status).toBe('paused')
    })
  })

  describe('start and active lifecycle', () => {
    it('returns synchronous preflight failures for background starts', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      expect(queueManager.requestStart('missing-job')).toEqual({
        success: false,
        error: 'Not connected to ComfyUI server'
      })
    })

    it('starts an eligible job in the background after preflight', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      const jobId = jobRepo.create({ name: 'Draft Job', config: '{}' })
      const startJob = vi.spyOn(queueManager, 'startJob').mockResolvedValue(undefined)

      expect(queueManager.requestStart(jobId)).toEqual({ success: true })
      expect(startJob).toHaveBeenCalledWith(jobId)
    })

    it('rejects background starts for terminal jobs', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      const jobId = jobRepo.create({ name: 'Done Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'completed')

      expect(queueManager.requestStart(jobId)).toEqual({
        success: false,
        error: 'Batch job cannot start from status: completed'
      })
      expect(queueManager.preflightStart(jobId, ['completed', 'failed', 'cancelled'])).toEqual({
        success: true
      })
    })

    it('rejects start when ComfyUI is disconnected', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      await expect(queueManager.startJob('job-1')).rejects.toThrow(
        'Not connected to ComfyUI server'
      )
    })

    it('rejects a duplicate start while another job is processing', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      Object.assign(queueManager, { _isProcessing: true })

      await expect(queueManager.startJob('job-1')).rejects.toThrow(
        'Queue is already processing a job'
      )
    })

    it('cleans up processing state and emits status after a successful run', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      const processJob = vi
        .spyOn(
          queueManager as unknown as { processJob: (jobId: string) => Promise<void> },
          'processJob'
        )
        .mockResolvedValue(undefined)
      const send = vi.fn()
      electronMocks.getAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send }
        }
      ])
      const jobId = jobRepo.create({ name: 'Lifecycle Job', config: '{}' })

      await queueManager.startJob(jobId)

      expect(processJob).toHaveBeenCalledWith(jobId)
      expect(queueManager.isProcessing).toBe(false)
      expect(queueManager.currentJobId).toBeNull()
      expect(databaseMocks.setBatchMode.mock.calls).toEqual([[true], [false]])
      expect(send).toHaveBeenCalledWith('queue:status-changed', {
        isProcessing: false,
        isPaused: false,
        currentJobId: null
      })
    })

    it('marks the job failed and still cleans up when processing throws', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      vi.spyOn(
        queueManager as unknown as { processJob: (jobId: string) => Promise<void> },
        'processJob'
      ).mockRejectedValue(new Error('process failed'))
      const jobId = jobRepo.create({ name: 'Failing Job', config: '{}' })

      await queueManager.startJob(jobId)

      expect(jobRepo.get(jobId)?.status).toBe('failed')
      expect(queueManager.isProcessing).toBe(false)
      expect(queueManager.currentJobId).toBeNull()
      expect(databaseMocks.setBatchMode.mock.calls).toEqual([[true], [false]])
    })

    it('pauses and hot-resumes the active job', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({ name: 'Active Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      Object.assign(queueManager, {
        _isProcessing: true,
        _isPaused: false,
        _currentJobId: jobId
      })

      queueManager.pause()
      expect(queueManager.isPaused).toBe(true)
      expect(jobRepo.get(jobId)?.status).toBe('paused')

      await queueManager.resume(jobId)
      expect(queueManager.isPaused).toBe(false)
      expect(jobRepo.get(jobId)?.status).toBe('running')
    })

    it('hot-cancels remaining tasks and tolerates interrupt failure', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      const jobId = jobRepo.create({ name: 'Active Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
      Object.assign(queueManager, {
        _isProcessing: true,
        _isPaused: true,
        _currentJobId: jobId
      })
      vi.mocked(comfyuiManager.restClient.interrupt).mockRejectedValueOnce(
        new Error('interrupt unavailable')
      )

      expect(() => queueManager.cancel(jobId)).not.toThrow()
      await Promise.resolve()

      expect(queueManager.isPaused).toBe(false)
      expect(jobRepo.get(jobId)?.status).toBe('cancelled')
      expect(taskRepo.listByJob(jobId)[0].status).toBe('cancelled')
      expect(comfyuiManager.restClient.interrupt).toHaveBeenCalledOnce()
    })
  })

  describe('cold cancel', () => {
    it('cancels orphaned running job via cancel()', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Stale Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')

      queueManager.cancel(jobId)

      const job = jobRepo.get(jobId)
      expect(job?.status).toBe('cancelled')
      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('cancelled')
    })

    it('cancels paused job via cancel()', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Paused Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'paused')
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' }
      ])

      queueManager.cancel(jobId)

      expect(jobRepo.get(jobId)?.status).toBe('cancelled')
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks.every((t) => t.status === 'cancelled')).toBe(true)
    })

    it('cancels only the selected paused job when multiple jobs were recovered', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const firstId = jobRepo.create({ name: 'Paused Job 1', config: '{}' })
      const secondId = jobRepo.create({ name: 'Paused Job 2', config: '{}' })
      jobRepo.updateStatus(firstId, 'paused')
      jobRepo.updateStatus(secondId, 'paused')

      queueManager.cancel(secondId)

      expect(jobRepo.get(firstId)?.status).toBe('paused')
      expect(jobRepo.get(secondId)?.status).toBe('cancelled')
    })

    it('does nothing when no active or stale jobs exist', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Draft Job', config: '{}' })
      expect(() => queueManager.cancel(jobId)).toThrow('cannot be cancelled')
      expect(jobRepo.get(jobId)?.status).toBe('draft')
    })
  })

  describe('cold resume', () => {
    it('does nothing when no paused jobs exist', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Draft Job', config: '{}' })
      await expect(queueManager.resume(jobId)).rejects.toThrow('is not paused')
      expect(jobRepo.get(jobId)?.status).toBe('draft')
    })

    it('starts only the selected paused job when no loop is active', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const firstId = jobRepo.create({ name: 'Paused Job 1', config: '{}' })
      const secondId = jobRepo.create({ name: 'Paused Job 2', config: '{}' })
      jobRepo.updateStatus(firstId, 'paused')
      jobRepo.updateStatus(secondId, 'paused')
      const startJob = vi.spyOn(queueManager, 'startJob').mockResolvedValue(undefined)

      await queueManager.resume(secondId)

      expect(startJob).toHaveBeenCalledOnce()
      expect(startJob).toHaveBeenCalledWith(secondId)
      expect(jobRepo.get(firstId)?.status).toBe('paused')
    })
  })

  describe('retry settings', () => {
    it('uses the canonical max_retries setting', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')

      settingsRepo.set('max_retries', '2')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      vi.spyOn(
        queueManager as unknown as { processJob: (jobId: string) => Promise<void> },
        'processJob'
      ).mockResolvedValue(undefined)

      const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
      await queueManager.startJob(jobId)

      expect((queueManager as { _maxRetries: number })._maxRetries).toBe(2)
    })

    it('falls back to the default retry count when the stored setting is invalid', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')

      settingsRepo.set('batch.maxRetries', 'not-a-number')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      vi.spyOn(
        queueManager as unknown as { processJob: (jobId: string) => Promise<void> },
        'processJob'
      ).mockResolvedValue(undefined)

      const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
      await queueManager.startJob(jobId)

      expect((queueManager as { _maxRetries: number })._maxRetries).toBe(3)
    })

    it('stops after the configured number of retries and marks the task failed', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
      const task = taskRepo.listByJob(jobId)[0]
      const processTask = vi
        .spyOn(
          queueManager as unknown as {
            processTask: (...args: unknown[]) => Promise<void>
          },
          'processTask'
        )
        .mockRejectedValue(new Error('permanent failure'))
      const manager = queueManager as unknown as {
        _maxRetries: number
        processTaskWithRetries: (
          task: Record<string, unknown>,
          workflow: Record<string, unknown>,
          jobId: string,
          config: Record<string, unknown>,
          outputRoot: string
        ) => Promise<{ success: boolean; cancelled: boolean; error?: Error }>
      }
      manager._maxRetries = 2

      const result = await manager.processTaskWithRetries(task, {}, jobId, {}, 'C:\\output')

      expect(processTask).toHaveBeenCalledTimes(3)
      expect(result.success).toBe(false)
      expect(result.cancelled).toBe(false)
      expect(result.error?.message).toBe('permanent failure')
      const updated = taskRepo.listByJob(jobId)[0]
      expect(updated.status).toBe('failed')
      expect(updated.retry_count).toBe(2)
    })

    it('reports success when a retry eventually completes', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
      const task = taskRepo.listByJob(jobId)[0]
      const processTask = vi
        .spyOn(
          queueManager as unknown as {
            processTask: (...args: unknown[]) => Promise<void>
          },
          'processTask'
        )
        .mockRejectedValueOnce(new Error('transient failure'))
        .mockResolvedValueOnce(undefined)
      const manager = queueManager as unknown as {
        _maxRetries: number
        processTaskWithRetries: (
          task: Record<string, unknown>,
          workflow: Record<string, unknown>,
          jobId: string,
          config: Record<string, unknown>,
          outputRoot: string
        ) => Promise<{ success: boolean; cancelled: boolean }>
      }
      manager._maxRetries = 2

      const result = await manager.processTaskWithRetries(task, {}, jobId, {}, 'C:\\output')

      expect(processTask).toHaveBeenCalledTimes(2)
      expect(result.success).toBe(true)
      expect(taskRepo.listByJob(jobId)[0].retry_count).toBe(1)
    })
  })

  describe('task result consistency', () => {
    function createTaskFixture(): { jobId: string; task: Record<string, unknown> } {
      const jobId = jobRepo.create({ name: 'Result Job', config: '{}' })
      taskRepo.createBulk([
        {
          job_id: jobId,
          prompt_data: JSON.stringify({ positive: 'prompt', negative: '', seed: 42 }),
          sort_order: 0,
          metadata: JSON.stringify({
            combinationIndex: 0,
            imageIndex: 0,
            totalInCombination: 1
          })
        }
      ])
      return { jobId, task: taskRepo.listByJob(jobId)[0] }
    }

    function makeConfig(): Record<string, unknown> {
      return {
        name: 'Result Job',
        workflowId: 'workflow-id',
        moduleSelections: [],
        countPerCombination: 1,
        seedMode: 'random',
        outputFolderPattern: '{job}',
        fileNamePattern: '{index}'
      }
    }

    it('fails a completed prompt that contains no output images', async () => {
      const outputRoot = mkdtempSync(join(tmpdir(), 'cam-no-output-'))
      try {
        const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
        const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
        const taskGenerator = await import('../../../../src/main/services/batch/task-generator')
        const { jobId, task } = createTaskFixture()
        vi.mocked(taskGenerator.resolveOutputPath).mockReturnValue('job')
        vi.mocked(comfyuiManager.restClient.queuePrompt).mockResolvedValue({
          prompt_id: 'prompt-1'
        })
        vi.mocked(comfyuiManager.restClient.deleteFromHistory).mockResolvedValue(undefined)
        vi.spyOn(
          queueManager as unknown as {
            waitForCompletion: () => Promise<{ outputs: Record<string, unknown> }>
          },
          'waitForCompletion'
        ).mockResolvedValue({ outputs: {} })
        const manager = queueManager as unknown as {
          processTask: (
            task: Record<string, unknown>,
            workflow: Record<string, unknown>,
            jobId: string,
            config: Record<string, unknown>,
            outputRoot: string
          ) => Promise<void>
        }

        await expect(
          manager.processTask(task, {}, jobId, makeConfig(), outputRoot)
        ).rejects.toThrow('completed without output images')
        expect(new GeneratedImageRepository().list({ page: 1, pageSize: 10 }).total).toBe(0)
        expect(comfyuiManager.restClient.deleteFromHistory).toHaveBeenCalledWith(['prompt-1'])
      } finally {
        rmSync(outputRoot, { recursive: true, force: true })
      }
    })

    it('rolls back gallery rows and files when persistence fails partway through', async () => {
      const outputRoot = mkdtempSync(join(tmpdir(), 'cam-partial-output-'))
      try {
        const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
        const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
        const taskGenerator = await import('../../../../src/main/services/batch/task-generator')
        const { jobId, task } = createTaskFixture()
        vi.mocked(taskGenerator.resolveOutputPath).mockReturnValue('job')
        vi.mocked(comfyuiManager.restClient.queuePrompt).mockResolvedValue({
          prompt_id: 'prompt-2'
        })
        vi.mocked(comfyuiManager.restClient.getImage)
          .mockResolvedValueOnce(Buffer.from('first'))
          .mockResolvedValueOnce(Buffer.from('second'))
        vi.mocked(comfyuiManager.restClient.deleteFromHistory).mockResolvedValue(undefined)
        vi.spyOn(
          queueManager as unknown as {
            waitForCompletion: () => Promise<{ outputs: Record<string, unknown> }>
          },
          'waitForCompletion'
        ).mockResolvedValue({
          outputs: {
            node: {
              images: [
                { filename: 'first.png', subfolder: '', type: 'output' },
                { filename: 'second.png', subfolder: '', type: 'output' }
              ]
            }
          }
        })
        mockDb.run(`CREATE TRIGGER fail_second_generated_image
          BEFORE INSERT ON generated_images
          WHEN NEW.file_path LIKE '%_001.png'
          BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END`)
        const manager = queueManager as unknown as {
          processTask: (
            task: Record<string, unknown>,
            workflow: Record<string, unknown>,
            jobId: string,
            config: Record<string, unknown>,
            outputRoot: string
          ) => Promise<void>
        }

        await expect(
          manager.processTask(task, {}, jobId, makeConfig(), outputRoot)
        ).rejects.toThrow('simulated persistence failure')
        expect(new GeneratedImageRepository().list({ page: 1, pageSize: 10 }).total).toBe(0)
        expect(existsSync(join(outputRoot, 'job', '0001.png'))).toBe(false)
        expect(existsSync(join(outputRoot, 'job', '0001_001.png'))).toBe(false)
      } finally {
        rmSync(outputRoot, { recursive: true, force: true })
      }
    })
  })

  describe('resolveConfiguredOutputRoot', () => {
    it('prefers output_directory over legacy output.directory', async () => {
      const { resolveConfiguredOutputRoot } =
        await import('../../../../src/main/services/output-root')
      const settings = {
        get(key: string) {
          return (
            (
              {
                output_directory: 'C:\\gallery-output',
                'output.directory': 'C:\\legacy-output'
              } as Record<string, string | undefined>
            )[key] ?? null
          )
        }
      }

      expect(resolveConfiguredOutputRoot(settings, 'C:\\fallback')).toBe('C:\\gallery-output')
    })

    it('falls back to legacy output.directory when output_directory is missing', async () => {
      const { resolveConfiguredOutputRoot } =
        await import('../../../../src/main/services/output-root')
      const settings = {
        get(key: string) {
          return (
            ({ 'output.directory': 'C:\\legacy-output' } as Record<string, string | undefined>)[
              key
            ] ?? null
          )
        }
      }

      expect(resolveConfiguredOutputRoot(settings, 'C:\\fallback')).toBe('C:\\legacy-output')
    })
  })
})
