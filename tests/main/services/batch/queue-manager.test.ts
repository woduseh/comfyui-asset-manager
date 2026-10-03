import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import type { Database as SqlJsDatabase } from 'sql.js'
import { openTestDatabase } from '../../../helpers/database'
import * as database from '@main/services/database'
import type { MockInstance } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PromptExecutionError } from '../../../../src/main/services/batch/wait-for-prompt'

let mockDb: SqlJsDatabase

let fixture: Awaited<ReturnType<typeof openTestDatabase>>
let setBatchModeSpy: MockInstance

const electronMocks = vi.hoisted(() => ({
  userDataPath: '',
  getAllWindows: vi.fn(() => [] as Array<Record<string, unknown>>)
}))

const journalMocks = vi.hoisted(() => ({
  recover: vi.fn(() => [] as Array<{ taskId: string; promptId: string; paths: string[] }>)
}))

vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('electron', () => ({
  app: { getPath: () => electronMocks.userDataPath },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows }
}))

vi.mock('../../../../src/main/services/batch/output-journal', () => ({
  beginTaskOutputJournal: () => ({ plan: vi.fn(), discard: vi.fn() }),
  recoverTaskOutputJournals: journalMocks.recover
}))

vi.mock('../../../../src/main/services/comfyui/manager', () => ({
  comfyuiManager: {
    isConnected: false,
    acquireExecution() {
      return {
        client: this.restClient,
        serverUrl: this.restClient.serverUrl,
        clientId: 'test-client',
        webSocket: null,
        release: vi.fn()
      }
    },
    clientId: 'test-client',
    restClient: {
      serverUrl: 'http://localhost:8188',
      queuePrompt: vi.fn(),
      getImage: vi.fn(),
      deleteFromHistory: vi.fn()
    },
    wsClient: null
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

describe('QueueManager Recovery', () => {
  let jobRepo: BatchJobRepository
  let taskRepo: BatchTaskRepository
  let settingsRepo: SettingsRepository

  beforeEach(async () => {
    fixture = await openTestDatabase((path) => {
      electronMocks.userDataPath = path
    })
    mockDb = fixture.db
    setBatchModeSpy = vi.spyOn(database, 'setBatchMode')
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
      _maxRetries: 3,
      recoveryError: null,
      stopping: false,
      activeRun: null,
      execution: comfyuiManager.acquireExecution()
    })
    ;(comfyuiManager as { isConnected: boolean }).isConnected = false
    journalMocks.recover.mockReset().mockReturnValue([])
    vi.mocked(comfyuiManager.restClient.queuePrompt).mockReset()
    vi.mocked(comfyuiManager.restClient.getImage).mockReset()
    vi.mocked(comfyuiManager.restClient.deleteFromHistory).mockReset()
    electronMocks.getAllWindows.mockReset().mockReturnValue([])
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.close()
  })

  describe('recoverInterruptedJobs', () => {
    it('converts orphaned running jobs to paused', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Test Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')

      await queueManager.recoverInterruptedJobs()

      const job = jobRepo.get(jobId)
      expect(job?.status).toBe('paused')
    })

    it('recovers stuck tasks without losing the accepted remote request', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Test Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      for (const task of [
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 2, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')
      taskRepo.updateStatus(tasks[1].id as string, 'running', { comfyui_prompt_id: 'p-1' })
      // tasks[2] stays pending

      await queueManager.recoverInterruptedJobs()

      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('pending')
      expect(updated[1].comfyui_prompt_id).toBe('p-1')
      expect(updated[2].status).toBe('pending')
    })

    it('does not affect completed or cancelled jobs', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const completedId = jobRepo.create({ name: 'Done Job', config: '{}' })
      jobRepo.updateStatus(completedId, 'completed')
      const cancelledId = jobRepo.create({ name: 'Cancelled Job', config: '{}' })
      jobRepo.updateStatus(cancelledId, 'cancelled')

      await queueManager.recoverInterruptedJobs()

      expect(jobRepo.get(completedId)?.status).toBe('completed')
      expect(jobRepo.get(cancelledId)?.status).toBe('cancelled')
    })

    it('recovers multiple orphaned running jobs', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const job1 = jobRepo.create({ name: 'Job 1', config: '{}' })
      const job2 = jobRepo.create({ name: 'Job 2', config: '{}' })
      jobRepo.updateStatus(job1, 'running')
      jobRepo.updateStatus(job2, 'running')

      await queueManager.recoverInterruptedJobs()

      expect(jobRepo.get(job1)?.status).toBe('paused')
      expect(jobRepo.get(job2)?.status).toBe('paused')
    })

    it('reconciles progress when a cancelled job has an uncommitted output journal', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({
        name: 'Cancelled output commit',
        config: '{}',
        total_tasks: 1
      })
      const taskId = taskRepo.createSingle({
        job_id: jobId,
        prompt_data: '{}',
        sort_order: 0,
        metadata: '{}'
      })
      taskRepo.updateStatus(taskId, 'completed', { comfyui_prompt_id: 'remote' })
      jobRepo.updateProgress(jobId, 1, 0)
      jobRepo.updateStatus(jobId, 'cancelled')
      journalMocks.recover.mockReturnValue([{ taskId, promptId: 'remote', paths: [] }])

      await queueManager.recoverInterruptedJobs()

      expect(taskRepo.get(taskId)?.status).toBe('uncertain')
      expect(jobRepo.get(jobId)).toMatchObject({
        status: 'cancelled',
        completed_tasks: 0,
        failed_tasks: 0,
        uncertain_tasks: 1
      })
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

    it('contains background execution failures after an accepted start', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      const jobId = jobRepo.create({ name: 'Rejected Background Job', config: '{}' })
      const startJob = vi
        .spyOn(queueManager, 'startJob')
        .mockRejectedValueOnce(new Error('background failed'))

      expect(queueManager.requestStart(jobId)).toEqual({ success: true })
      await Promise.resolve()
      await Promise.resolve()
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
      expect(setBatchModeSpy.mock.calls).toEqual([[true], [false]])
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
      expect(setBatchModeSpy.mock.calls).toEqual([[true], [false]])
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

    it('hot-cancels unsubmitted tasks without globally interrupting unrelated server work', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({ name: 'Active Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
      Object.assign(queueManager, {
        _isProcessing: true,
        _isPaused: true,
        _currentJobId: jobId
      })

      expect(() => queueManager.cancel(jobId)).not.toThrow()
      await Promise.resolve()

      expect(queueManager.isPaused).toBe(false)
      expect(jobRepo.get(jobId)?.status).toBe('cancelled')
      expect(taskRepo.listByJob(jobId)[0].status).toBe('cancelled')
      expect(taskRepo.listByJob(jobId).every((task) => task.status !== 'submitting')).toBe(true)
    })
  })

  describe('cold cancel', () => {
    it('cancels orphaned running job via cancel()', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Stale Job', config: '{}' })
      jobRepo.updateStatus(jobId, 'running')
      for (const task of [
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
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
      for (const task of [
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }

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
    it('rejects a disconnected cold resume and preserves the paused job', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({ name: 'Disconnected resume', config: '{}' })
      jobRepo.updateStatus(jobId, 'paused')

      await expect(queueManager.resume(jobId)).rejects.toThrow('Not connected to ComfyUI server')
      expect(jobRepo.get(jobId)?.status).toBe('paused')
      expect(queueManager.isProcessing).toBe(false)
    })
    it('does nothing when no paused jobs exist', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')

      const jobId = jobRepo.create({ name: 'Draft Job', config: '{}' })
      await expect(queueManager.resume(jobId)).rejects.toThrow('is not paused')
      expect(jobRepo.get(jobId)?.status).toBe('draft')
    })

    it('starts only the selected paused job when no loop is active', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
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

      expect((queueManager as unknown as { _maxRetries: number })._maxRetries).toBe(2)
    })

    it('falls back to the default retry count when the stored setting is invalid', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')

      settingsRepo.set('max_retries', 'not-a-number')
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      vi.spyOn(
        queueManager as unknown as { processJob: (jobId: string) => Promise<void> },
        'processJob'
      ).mockResolvedValue(undefined)

      const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
      await queueManager.startJob(jobId)

      expect((queueManager as unknown as { _maxRetries: number })._maxRetries).toBe(3)
    })

    it('stops after the configured number of retries and marks the task failed', async () => {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
      taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
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

    it.each(['local', 'remote'])(
      'counts one %s failure as one retry when the next attempt completes',
      async (failureType) => {
        const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
        const jobId = jobRepo.create({ name: 'Retry Job', config: '{}' })
        taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
        const task = taskRepo.listByJob(jobId)[0]
        if (failureType === 'remote') {
          taskRepo.updateStatus(task.id as string, 'running', {
            comfyui_prompt_id: 'failed-remote'
          })
          task.comfyui_prompt_id = 'failed-remote'
        }
        const processTask = vi
          .spyOn(
            queueManager as unknown as {
              processTask: (...args: unknown[]) => Promise<void>
            },
            'processTask'
          )
          .mockRejectedValueOnce(
            failureType === 'remote'
              ? new PromptExecutionError('remote execution failed')
              : new Error('transient failure')
          )
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
        if (failureType === 'remote') {
          expect(taskRepo.get(task.id as string)?.comfyui_prompt_id).toBeNull()
        }
      }
    )
  })

  describe.each(['snapshot', 'legacy'] as const)('%s task execution', (mode) => {
    async function prepareJob(): Promise<{
      queueManager: typeof import('../../../../src/main/services/batch/queue-manager').queueManager
      manager: { processTask: (task: Record<string, unknown>) => Promise<void> }
      jobId: string
      expandBatchToTasksChunk: typeof import('../../../../src/main/services/batch/task-generator').expandBatchToTasksChunk
    }> {
      const { queueManager } = await import('../../../../src/main/services/batch/queue-manager')
      const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')
      const { expandBatchToTasksChunk } =
        await import('../../../../src/main/services/batch/task-generator')
      const config = {
        name: 'Execution Job',
        workflowId: 'workflow-id',
        moduleSelections: [],
        countPerCombination: 1,
        seedMode: 'fixed',
        outputFolderPattern: '{job}',
        fileNamePattern: '{index}'
      }
      mockDb.run("INSERT INTO workflows (id, name, api_json) VALUES ('workflow-id', 'Test', '{}')")
      const jobId = jobRepo.create({
        name: config.name,
        config: JSON.stringify(config),
        workflow_id: config.workflowId,
        total_tasks: 3,
        module_data_snapshot: mode === 'snapshot' ? '[]' : undefined
      })
      const generated = [0, 1, 2].map((index) => ({
        promptData: { positive: 'prompt', negative: '', seed: index, extraVariables: {} },
        sortOrder: index,
        metadata: { combinationIndex: index, imageIndex: 0, totalInCombination: 1 }
      }))
      vi.mocked(expandBatchToTasksChunk)
        .mockReset()
        .mockImplementation((_config, _data, start) => generated.slice(start, start + 2))
      if (mode === 'legacy') {
        for (const task of generated.map((task) => ({
          job_id: jobId,
          prompt_data: JSON.stringify(task.promptData),
          metadata: JSON.stringify(task.metadata),
          sort_order: task.sortOrder
        }))) {
          taskRepo.createSingle(task)
        }
      }
      ;(comfyuiManager as { isConnected: boolean }).isConnected = true
      settingsRepo.set('max_retries', '0')
      const manager = queueManager as unknown as {
        processTask: (task: Record<string, unknown>) => Promise<void>
      }
      return { queueManager, manager, jobId, expandBatchToTasksChunk }
    }

    it('continues after a failed task and persists aggregate progress', async () => {
      const { queueManager, manager, jobId, expandBatchToTasksChunk } = await prepareJob()
      const processed: number[] = []
      vi.spyOn(manager, 'processTask').mockImplementation(async (task) => {
        const order = task.sort_order as number
        processed.push(order)
        if (order === 1) throw new Error('Task failed')
        taskRepo.finish(task.id as string, 'completed')
      })

      await queueManager.startJob(jobId)

      expect(processed).toEqual([0, 1, 2])
      expect(taskRepo.listByJob(jobId).map((task) => task.status)).toEqual([
        'completed',
        'failed',
        'completed'
      ])
      expect(jobRepo.get(jobId)).toMatchObject({
        status: 'completed',
        completed_tasks: 2,
        failed_tasks: 1
      })
      if (mode === 'snapshot') {
        expect(vi.mocked(expandBatchToTasksChunk).mock.calls.map((call) => call[2])).toEqual([0, 2])
      } else {
        expect(expandBatchToTasksChunk).not.toHaveBeenCalled()
      }
    })

    it('stops executing on cancellation and cancels the already allocated chunk', async () => {
      const { queueManager, manager, jobId } = await prepareJob()
      const processTask = vi.spyOn(manager, 'processTask').mockImplementation(async () => {
        queueManager.cancel(jobId)
        throw new Error('Cancelled')
      })

      await queueManager.startJob(jobId)

      expect(processTask).toHaveBeenCalledTimes(1)
      expect(jobRepo.get(jobId)).toMatchObject({
        status: 'cancelled',
        completed_tasks: 0,
        failed_tasks: 0
      })
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks).toHaveLength(mode === 'snapshot' ? 2 : 3)
      expect(tasks.every((task) => task.status === 'cancelled')).toBe(true)
    })
  })

  describe('task result consistency', () => {
    function createTaskFixture(): { jobId: string; task: Record<string, unknown> } {
      const jobId = jobRepo.create({ name: 'Result Job', config: '{}' })
      taskRepo.createSingle({
        job_id: jobId,
        prompt_data: JSON.stringify({ positive: 'prompt', negative: '', seed: 42 }),
        sort_order: 0,
        metadata: JSON.stringify({
          combinationIndex: 0,
          imageIndex: 0,
          totalInCombination: 1
        })
      })
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
          prompt_id: 'prompt-1',
          number: 1,
          node_errors: {}
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
        expect(comfyuiManager.restClient.deleteFromHistory).not.toHaveBeenCalled()
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
          prompt_id: 'prompt-2',
          number: 2,
          node_errors: {}
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
