import { describe, it, expect, beforeEach, vi } from 'vitest'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

let mockDb: SqlJsDatabase

vi.mock('../../../../src/main/services/database/index', () => ({
  getDatabase: () => mockDb,
  saveDatabase: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
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
    COMFYUI_PREVIEW: 'comfyui:preview'
  }
}))

vi.mock('../../../../src/main/services/batch/task-generator', () => ({
  resolveOutputPath: vi.fn(),
  expandBatchToTasksChunk: vi.fn()
}))

import {
  BatchJobRepository,
  BatchTaskRepository
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
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('comfyui_host', 'localhost'), ('comfyui_port', '8188')`)
  db.run('PRAGMA foreign_keys = ON;')
}

describe('QueueManager Recovery', () => {
  let jobRepo: BatchJobRepository
  let taskRepo: BatchTaskRepository

  beforeEach(async () => {
    const SQL = await initSqlJs()
    mockDb = new SQL.Database()
    createTables(mockDb)
    jobRepo = new BatchJobRepository()
    taskRepo = new BatchTaskRepository()
  })

  describe('recoverInterruptedJobs', () => {
    it('converts orphaned running jobs to paused', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const jobId = jobRepo.create({ name: 'Test Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')

      queueManager.recoverInterruptedJobs()

      const job = jobRepo.get(jobId)
      expect(job?.status).toBe('paused')
    })

    it('resets stuck running tasks to pending', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

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
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const completedId = jobRepo.create({ name: 'Done Job', config: '{}' })
      jobRepo.updateStatus(completedId, 'completed')
      const cancelledId = jobRepo.create({ name: 'Cancelled Job', config: '{}' })
      jobRepo.updateStatus(cancelledId, 'cancelled')

      queueManager.recoverInterruptedJobs()

      expect(jobRepo.get(completedId)?.status).toBe('completed')
      expect(jobRepo.get(cancelledId)?.status).toBe('cancelled')
    })

    it('recovers multiple orphaned running jobs', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const job1 = jobRepo.create({ name: 'Job 1', config: '{}' })
      const job2 = jobRepo.create({ name: 'Job 2', config: '{}' })
      jobRepo.updateStatus(job1, 'running')
      jobRepo.updateStatus(job2, 'running')

      queueManager.recoverInterruptedJobs()

      expect(jobRepo.get(job1)?.status).toBe('paused')
      expect(jobRepo.get(job2)?.status).toBe('paused')
    })
  })

  describe('cold cancel', () => {
    it('cancels orphaned running job via cancel()', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const jobId = jobRepo.create({ name: 'Stale Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')

      queueManager.cancel()

      const job = jobRepo.get(jobId)
      expect(job?.status).toBe('cancelled')
      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('cancelled')
    })

    it('cancels paused job via cancel()', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const jobId = jobRepo.create({ name: 'Paused Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'paused')
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' }
      ])

      queueManager.cancel()

      expect(jobRepo.get(jobId)?.status).toBe('cancelled')
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks.every((t) => t.status === 'cancelled')).toBe(true)
    })

    it('does nothing when no active or stale jobs exist', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const jobId = jobRepo.create({ name: 'Draft Job', config: '{}' })
      queueManager.cancel()
      expect(jobRepo.get(jobId)?.status).toBe('draft')
    })
  })

  describe('cold resume', () => {
    it('does nothing when no paused jobs exist', async () => {
      const { queueManager } = await import(
        '../../../../src/main/services/batch/queue-manager'
      )

      const jobId = jobRepo.create({ name: 'Draft Job', config: '{}' })
      await queueManager.resume()
      expect(jobRepo.get(jobId)?.status).toBe('draft')
    })
  })
})
