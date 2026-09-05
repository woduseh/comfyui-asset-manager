/**
 * Queue Manager & Batch Executor
 *
 * Processes batch tasks sequentially: submits prompts to ComfyUI,
 * monitors via WebSocket, downloads results, and saves to disk.
 */

import { existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import { comfyuiManager } from '../comfyui/manager'
import { resolveConfiguredOutputRoot } from '../output-root'
import {
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository,
  WorkflowRepository,
  SettingsRepository
} from '../database/repositories'
import { setBatchMode, withTransaction, flushDatabase } from '../database'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc-contract'
import log from '../../logger'
import {
  TASK_CHUNK_SIZE,
  PAUSE_CHECK_INTERVAL_MS,
  TASK_EXECUTION_TIMEOUT_MS,
  COMPLETION_POLL_INTERVAL_MS,
  CLEAR_PROMPT_DATA_CHUNK_INTERVAL
} from '../../constants'
import { expandBatchToTasksChunk } from '../batch/task-generator'
import type { BatchConfig } from '@shared/ipc-contract'
import type { ModuleDataSnapshot } from '../batch/task-generator'
import { isJsonObject } from '@shared/safe-json'
import { parseIntegerOrFallback } from '@shared/number'
import {
  computeEta,
  isBatchConfig,
  isModuleDataSnapshot,
  isTaskMetadata,
  isTaskPromptData,
  parseRequiredJson,
  pushDuration,
  type TaskMetadata,
  type TaskPromptData
} from './queue-utils'
import {
  cleanupPartialOutputFiles,
  createTaskOutputDirectory,
  downloadTaskImages,
  type TaskImageRecord
} from './task-output'
import { beginTaskOutputJournal, recoverTaskOutputJournals } from './output-journal'
import {
  waitForPrompt,
  PromptOutcomeUnknownError,
  PromptExecutionError,
  PromptWaitCancelledError
} from './wait-for-prompt'
import { injectPromptData } from './prompt-injection'

const batchJobRepo = new BatchJobRepository()
const batchTaskRepo = new BatchTaskRepository()
const imageRepo = new GeneratedImageRepository()
const workflowRepo = new WorkflowRepository()
const settingsRepo = new SettingsRepository()

interface TaskRunResult {
  success: boolean
  cancelled: boolean
  durationMs: number
  error?: Error
}

class QueueManager {
  private _isProcessing = false
  private _isPaused = false
  private _isCancelled = false
  private _currentJobId: string | null = null
  private _maxRetries = 3
  private recoveryError: string | null = null
  private activeRun: Promise<void> | null = null
  private stopping = false

  get isProcessing(): boolean {
    return this._isProcessing
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  get currentJobId(): string | null {
    return this._currentJobId
  }

  /**
   * Recover jobs that were interrupted by a crash or force-quit.
   * Finds orphaned 'running' jobs, resets their stuck tasks, and marks them as 'paused'.
   */
  async recoverInterruptedJobs(): Promise<void> {
    try {
      for (const entry of recoverTaskOutputJournals((entry) => {
        const task = batchTaskRepo.get(entry.taskId)
        return (
          task?.status === 'completed' &&
          entry.paths.every((path) => existsSync(path) && imageRepo.hasTrackedAssetPath(path))
        )
      })) {
        const task = batchTaskRepo.get(entry.taskId)
        if (!task) throw new Error('Output journal references a missing task: ' + entry.taskId)
        batchTaskRepo.updateStatus(entry.taskId, 'uncertain', {
          error_message: 'Output persistence was interrupted; retained files require reconciliation'
        })
        this.syncProgress(task.job_id as string)
        if (batchJobRepo.get(task.job_id as string)?.status !== 'cancelled')
          batchJobRepo.updateStatus(task.job_id as string, 'paused')
      }
      for (const job of batchJobRepo.list()) {
        if (job.status !== 'running' && job.status !== 'paused') continue
        batchTaskRepo.resetRunningTasksByJob(job.id as string)
        this.syncProgress(job.id as string)
        batchJobRepo.updateStatus(job.id as string, 'paused')
      }
      await flushDatabase()
    } catch (error) {
      this.recoveryError = String(error)
      log.error('Queue recovery requires attention:', error)
    }
  }

  private syncProgress(jobId: string): void {
    batchJobRepo.updateProgress(
      jobId,
      batchTaskRepo.countByJobStatus(jobId).completed ?? 0,
      batchTaskRepo.countByJobStatus(jobId).failed ?? 0
    )
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    this._isCancelled = true
    this._isPaused = false
    await this.activeRun
    await flushDatabase()
  }

  /**
   * Start processing a batch job
   */
  preflightStart(
    jobId: string,
    allowedStatuses: readonly string[] = ['draft', 'paused']
  ): { success: boolean; error?: string } {
    if (this.stopping) return { success: false, error: 'Application is shutting down' }
    if (this.recoveryError) return { success: false, error: this.recoveryError }
    if ((batchTaskRepo.countByJobStatus(jobId).uncertain ?? 0) > 0)
      return { success: false, error: 'Task outcome requires reconciliation before resuming' }
    if (this._isProcessing) {
      return { success: false, error: 'Queue is already processing a job' }
    }
    if (!comfyuiManager.isConnected) {
      return { success: false, error: 'Not connected to ComfyUI server' }
    }

    const job = batchJobRepo.get(jobId)
    if (!job) {
      return { success: false, error: `Batch job not found: ${jobId}` }
    }
    if (!allowedStatuses.includes(job.status as string)) {
      return { success: false, error: `Batch job cannot start from status: ${job.status}` }
    }

    return { success: true }
  }

  requestStart(jobId: string): { success: boolean; error?: string } {
    const preflight = this.preflightStart(jobId)
    if (!preflight.success) return preflight

    void this.startJob(jobId).catch((error) => {
      log.error('[QueueManager] Background job execution error:', error)
    })
    return { success: true }
  }

  startJob(jobId: string): Promise<void> {
    const check = this.preflightStart(jobId)
    if (!check.success) return Promise.reject(new Error(check.error))
    this.activeRun = this.runJob(jobId)
    return this.activeRun
  }

  private async runJob(jobId: string): Promise<void> {
    this._isProcessing = true
    this._isPaused = false
    this._isCancelled = false
    this._currentJobId = jobId
    setBatchMode(true)
    this.sendToRenderer(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, true)

    // Load retry setting
    const retryStr = settingsRepo.get('max_retries') ?? settingsRepo.get('batch.maxRetries')
    this._maxRetries = parseIntegerOrFallback(retryStr, 3)

    batchJobRepo.updateStatus(jobId, 'running')
    let persistenceError: unknown

    try {
      await this.processJob(jobId)
    } catch (error) {
      log.error('Job execution error:', error)
      batchJobRepo.updateStatus(
        jobId,
        this._isCancelled ? (this.stopping ? 'paused' : 'cancelled') : 'failed'
      )
    } finally {
      if (this.stopping) batchJobRepo.updateStatus(jobId, 'paused')
      try {
        await flushDatabase()
      } catch (error) {
        this.recoveryError = 'Database durability requires attention: ' + String(error)
        persistenceError = error
      } finally {
        this._isProcessing = false
        this._isPaused = false
        this._currentJobId = null
        setBatchMode(false)
        this.sendStatusToRenderer()
      }
    }
    if (persistenceError) throw persistenceError
  }

  /**
   * Pause processing
   */
  pause(): void {
    this._isPaused = true
    if (this._currentJobId) {
      batchJobRepo.updateStatus(this._currentJobId, 'paused')
    }
  }

  /**
   * Resume processing.
   * Supports "hot resume" (active loop paused) and "cold resume" (restart after crash).
   */
  async resume(jobId: string): Promise<void> {
    if (this.stopping) throw new Error('Application is shutting down')
    if ((batchTaskRepo.countByJobStatus(jobId).uncertain ?? 0) > 0)
      throw new Error('Task outcome requires reconciliation before resuming')
    // Hot resume: currently paused in an active processing loop
    if (this._currentJobId && this._isPaused) {
      if (this._currentJobId !== jobId) {
        throw new Error(`Batch job is not the active paused job: ${jobId}`)
      }
      this._isPaused = false
      batchJobRepo.updateStatus(this._currentJobId, 'running')
      return
    }

    // Cold resume: no active loop, restart the explicitly selected paused job.
    if (!this._isProcessing) {
      const job = batchJobRepo.get(jobId)
      if (!job || job.status !== 'paused') {
        throw new Error(`Batch job is not paused: ${jobId}`)
      }
      const check = this.preflightStart(jobId, ['paused'])
      if (!check.success) throw new Error(check.error)
      log.info(`[QueueManager] Cold resuming job: ${jobId}`)
      void this.startJob(jobId).catch((error) => {
        log.error('[QueueManager] Cold resume failed:', error)
      })
    }
  }

  /**
   * Cancel the current job.
   * Supports "hot cancel" (active loop running) and "cold cancel" (stale state after crash).
   */
  cancel(jobId: string): void {
    // Hot cancel: QueueManager is actively processing
    if (this._currentJobId) {
      if (this._currentJobId !== jobId) {
        throw new Error(`Batch job is not the active job: ${jobId}`)
      }
      this._isCancelled = true
      this._isPaused = false
      batchJobRepo.updateStatus(this._currentJobId, 'cancelled')
      batchTaskRepo.cancelRemainingTasksByJob(this._currentJobId)
      return
    }

    // Cold cancel: no active loop, cancel only the explicitly selected stale job.
    if (!this._isProcessing) {
      const job = batchJobRepo.get(jobId)
      if (!job || (job.status !== 'running' && job.status !== 'paused')) {
        throw new Error(`Batch job cannot be cancelled from status: ${String(job?.status)}`)
      }
      log.info(`[QueueManager] Cold cancelling job: ${jobId}`)
      batchTaskRepo.cancelRemainingTasksByJob(jobId)
      batchJobRepo.updateStatus(jobId, 'cancelled')
    }
  }

  private async processJob(jobId: string): Promise<void> {
    const job = batchJobRepo.get(jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)

    const workflow = workflowRepo.get(job.workflow_id as string)
    if (!workflow) throw new Error(`Workflow not found for job`)

    const apiJson = parseRequiredJson<Record<string, unknown>>(
      workflow.api_json as string,
      'Workflow API JSON',
      isJsonObject,
      'Workflow API JSON must be an object'
    )
    const outputRoot = resolveConfiguredOutputRoot(settingsRepo)
    const jobConfig = parseRequiredJson<BatchConfig>(
      job.config as string,
      'Batch job config',
      isBatchConfig,
      'Batch job config has an invalid shape'
    )

    let completedCount = batchTaskRepo.countByJobStatus(jobId).completed ?? 0
    let failedCount = batchTaskRepo.countByJobStatus(jobId).failed ?? 0
    const totalTasks = (job.total_tasks as number) || 0

    // ETA tracking — limited to moving average window to avoid O(n²) accumulation
    const taskDurations: number[] = []
    let chunksSinceLastClear = 0

    const executeTrackedTask = async (task: Record<string, unknown>): Promise<void> => {
      const taskId = task.id as string
      const result = await this.processTaskWithRetries(task, apiJson, jobId, jobConfig, outputRoot)
      if (result.cancelled) return

      if (result.success) {
        completedCount++
        pushDuration(taskDurations, result.durationMs)
        batchJobRepo.updateProgress(jobId, completedCount, failedCount)
        this.sendTaskCompletedEvent(
          jobId,
          taskId,
          completedCount,
          failedCount,
          totalTasks,
          taskDurations
        )
        return
      }

      failedCount++
      batchJobRepo.updateProgress(jobId, completedCount, failedCount)
      const remainingTasks = totalTasks - completedCount - failedCount
      const etaMs = computeEta(taskDurations, remainingTasks)
      this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_FAILED, {
        jobId,
        taskId,
        error: result.error?.message ?? 'Task failed',
        completed: completedCount,
        failed: failedCount,
        total: totalTasks,
        etaMs
      })
    }

    const moduleDataSnapshot = job.module_data_snapshot
      ? parseRequiredJson<ModuleDataSnapshot>(
          job.module_data_snapshot as string,
          'Batch module snapshot',
          isModuleDataSnapshot,
          'Batch module snapshot must be an array'
        )
      : null

    while (!this._isCancelled) {
      let tasks = batchTaskRepo.listByJobPending(jobId, TASK_CHUNK_SIZE)
      if (tasks.length === 0 && moduleDataSnapshot) {
        const startIndex = batchTaskRepo.nextSortOrder(jobId)
        if (startIndex < totalTasks) {
          const generated = expandBatchToTasksChunk(
            jobConfig,
            moduleDataSnapshot,
            startIndex,
            TASK_CHUNK_SIZE
          )
          withTransaction(() => {
            for (const task of generated)
              batchTaskRepo.createSingle({
                job_id: jobId,
                prompt_data: JSON.stringify(task.promptData),
                metadata: JSON.stringify(task.metadata),
                sort_order: task.sortOrder
              })
          })
          tasks = batchTaskRepo.listByJobPending(jobId, TASK_CHUNK_SIZE)
        }
      }
      if (tasks.length === 0) break

      for (const task of tasks) {
        while (this._isPaused && !this._isCancelled) {
          await this.sleep(PAUSE_CHECK_INTERVAL_MS)
        }
        if (this._isCancelled) break

        await executeTrackedTask(task)
      }

      if (this._isCancelled) break
      if (moduleDataSnapshot && ++chunksSinceLastClear >= CLEAR_PROMPT_DATA_CHUNK_INTERVAL) {
        batchTaskRepo.clearPromptDataForCompleted(jobId)
        chunksSinceLastClear = 0
      }
    }

    if (!this._isCancelled) {
      if (completedCount + failedCount !== totalTasks)
        throw new Error('Task counts do not cover the job')
      batchJobRepo.updateStatus(jobId, 'completed')
      this.sendToRenderer(IPC_CHANNELS.QUEUE_JOB_COMPLETED, { jobId })
    }
  }

  private sendTaskCompletedEvent(
    jobId: string,
    taskId: string,
    completedCount: number,
    failedCount: number,
    totalTasks: number,
    taskDurations: number[]
  ): void {
    const avgDuration = taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
    const remainingTasks = totalTasks - completedCount - failedCount
    const etaMs = computeEta(taskDurations, remainingTasks) ?? 0

    this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_COMPLETED, {
      jobId,
      taskId,
      completed: completedCount,
      total: totalTasks,
      etaMs,
      avgTaskDurationMs: Math.round(avgDuration)
    })
  }

  private async processTaskWithRetries(
    task: Record<string, unknown>,
    baseApiJson: Record<string, unknown>,
    jobId: string,
    jobConfig: BatchConfig,
    outputRoot: string
  ): Promise<TaskRunResult> {
    const taskId = task.id as string
    let retryCount = Number.isInteger(task.retry_count) ? (task.retry_count as number) : 0
    const startedAt = Date.now()

    while (true) {
      try {
        await this.processTask(task, baseApiJson, jobId, jobConfig, outputRoot)
        return {
          success: true,
          cancelled: false,
          durationMs: Date.now() - startedAt
        }
      } catch (error) {
        const taskError = error instanceof Error ? error : new Error(String(error))
        if (
          taskError instanceof PromptOutcomeUnknownError ||
          taskError instanceof PromptWaitCancelledError
        ) {
          batchTaskRepo.updateStatus(
            taskId,
            this.stopping && taskError instanceof PromptWaitCancelledError && task.comfyui_prompt_id
              ? 'pending'
              : 'uncertain',
            { error_message: taskError.message }
          )
          this.syncProgress(jobId)
          this._isCancelled = true
          if (batchJobRepo.get(jobId)?.status !== 'cancelled')
            batchJobRepo.updateStatus(jobId, 'paused')
        }
        if (this._isCancelled || taskError.message === 'Cancelled') {
          return {
            success: false,
            cancelled: true,
            durationMs: Date.now() - startedAt,
            error: taskError
          }
        }

        if (retryCount >= this._maxRetries) {
          batchTaskRepo.updateStatus(taskId, 'failed', { error_message: taskError.message })
          return {
            success: false,
            cancelled: false,
            durationMs: Date.now() - startedAt,
            error: taskError
          }
        }

        if (taskError instanceof PromptExecutionError) {
          task.comfyui_prompt_id = null
        }
        while (this._isPaused && !this._isCancelled) await this.sleep(PAUSE_CHECK_INTERVAL_MS)
        if (this._isCancelled)
          return { success: false, cancelled: true, durationMs: Date.now() - startedAt }
        retryCount++
        task.retry_count = retryCount
        batchTaskRepo.updateStatus(taskId, 'retrying', {
          error_message: taskError.message,
          ...(taskError instanceof PromptExecutionError ? { comfyui_prompt_id: null } : {})
        })
      }
    }
  }

  private async processTask(
    task: Record<string, unknown>,
    baseApiJson: Record<string, unknown>,
    jobId: string,
    jobConfig: BatchConfig,
    outputRoot: string
  ): Promise<void> {
    const taskId = task.id as string
    const promptData = parseRequiredJson<TaskPromptData>(
      task.prompt_data as string,
      'Batch task prompt data',
      isTaskPromptData,
      'Batch task prompt data has an invalid shape'
    )
    const metadata = parseRequiredJson<TaskMetadata>(
      task.metadata as string,
      'Batch task metadata',
      isTaskMetadata,
      'Batch task metadata has an invalid shape'
    )

    const workflowJson = structuredClone(baseApiJson)
    injectPromptData(workflowJson, promptData)
    let promptId = task.comfyui_prompt_id as string | undefined
    if (!promptId) {
      batchTaskRepo.updateStatus(taskId, 'submitting')
      await flushDatabase()
      if (this._isCancelled) throw new PromptWaitCancelledError()
      try {
        const result = await comfyuiManager.restClient.queuePrompt(
          workflowJson,
          comfyuiManager.clientId
        )
        promptId = result.prompt_id
        if (!promptId) throw new Error('Missing prompt ID')
      } catch (error) {
        throw new PromptOutcomeUnknownError('Submission outcome unknown: ' + String(error))
      }
      task.comfyui_prompt_id = promptId
    }
    batchTaskRepo.updateStatus(taskId, 'running', { comfyui_prompt_id: promptId })
    try {
      await flushDatabase()
    } catch (error) {
      throw new PromptOutcomeUnknownError('Could not persist accepted request: ' + String(error))
    }
    const historyResult = await this.waitForCompletion(promptId)
    const journal = beginTaskOutputJournal(taskId, promptId)
    let committed = false
    const target: { savedPaths: string[]; imageRecords: TaskImageRecord[] } = {
      savedPaths: [],
      imageRecords: []
    }
    try {
      const outputDirectory = createTaskOutputDirectory(outputRoot, jobConfig, metadata)
      await downloadTaskImages({
        outputs: historyResult?.outputs,
        outputRoot,
        outputDirectory,
        jobConfig,
        metadata,
        promptData,
        promptId,
        taskId,
        jobId,
        getImage: (filename, subfolder, type) =>
          comfyuiManager.restClient.getImage(filename, subfolder, type),
        target,
        journal
      })

      if (target.imageRecords.length === 0) {
        throw new Error(`ComfyUI prompt ${promptId} completed without output images`)
      }

      if (this._isCancelled) throw new Error('Cancelled')
      withTransaction(() => {
        for (const imageRecord of target.imageRecords) {
          imageRepo.create(imageRecord)
        }
        batchTaskRepo.updateStatus(taskId, 'completed', { result_path: target.savedPaths[0] })
        this.syncProgress(jobId)
      })
      committed = true
      await flushDatabase()
    } catch (error) {
      if (committed)
        throw new PromptOutcomeUnknownError('Output commit durability unknown: ' + String(error))
      const failures = cleanupPartialOutputFiles(target.savedPaths)
      if (failures.length)
        throw new PromptOutcomeUnknownError(
          'Partial output cleanup failed: ' + String(failures[0].error)
        )
      journal.discard()
      if (this._isCancelled)
        batchTaskRepo.updateStatus(taskId, this.stopping ? 'pending' : 'cancelled')
      throw error
    }
    try {
      journal.discard()
    } catch (error) {
      log.warn('Committed output journal cleanup failed:', error)
    }
    try {
      await comfyuiManager.restClient.deleteFromHistory([promptId])
    } catch (error) {
      log.debug('Failed to clear committed ComfyUI history:', error)
    }
  }

  private waitForCompletion(
    promptId: string,
    timeoutMs = TASK_EXECUTION_TIMEOUT_MS
  ): Promise<{ outputs: Record<string, unknown> }> {
    return waitForPrompt({
      client: comfyuiManager.restClient,
      webSocket: comfyuiManager.webSocket,
      promptId,
      timeoutMs,
      pollIntervalMs: COMPLETION_POLL_INTERVAL_MS,
      isCancelled: () => this._isCancelled
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private sendToRenderer<K extends IpcEventChannel>(channel: K, data: IpcEventPayload<K>): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  private sendStatusToRenderer(): void {
    this.sendToRenderer(IPC_CHANNELS.QUEUE_STATUS_CHANGED, {
      isProcessing: this._isProcessing,
      isPaused: this._isPaused,
      currentJobId: this._currentJobId
    })
  }
}

export const queueManager = new QueueManager()
