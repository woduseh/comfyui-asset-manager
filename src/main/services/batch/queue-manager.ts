/**
 * Queue Manager & Batch Executor
 *
 * Processes batch tasks sequentially: submits prompts to ComfyUI,
 * monitors via WebSocket, downloads results, and saves to disk.
 */

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
import { setBatchMode, withTransaction } from '../database'
import { IPC_CHANNELS } from '../../ipc/channels'
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
import type { BatchConfig, ModuleDataSnapshot } from '../batch/task-generator'
import { isJsonObject } from '../../utils/safe-json'
import { parseIntegerOrFallback } from '../../utils/number'
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
import { injectPromptData } from './prompt-injection'

const batchJobRepo = new BatchJobRepository()
const batchTaskRepo = new BatchTaskRepository()
const imageRepo = new GeneratedImageRepository()
const workflowRepo = new WorkflowRepository()
const settingsRepo = new SettingsRepository()

export interface QueueManagerEvents {
  progress: (data: { jobId: string; taskId: string; value: number; max: number }) => void
  taskComplete: (data: { jobId: string; taskId: string }) => void
  taskFailed: (data: { jobId: string; taskId: string; error: string }) => void
  jobComplete: (data: { jobId: string }) => void
  statusChange: (data: { isProcessing: boolean }) => void
}

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
  recoverInterruptedJobs(): void {
    const runningJobs = batchJobRepo.list('running')
    for (const job of runningJobs) {
      const jobId = job.id as string
      log.info(`[QueueManager] Recovering interrupted job: ${jobId}`)
      batchTaskRepo.resetRunningTasksByJob(jobId)
      batchJobRepo.updateStatus(jobId, 'paused')
    }
    if (runningJobs.length > 0) {
      log.info(`[QueueManager] Recovered ${runningJobs.length} interrupted job(s)`)
    }
  }

  /**
   * Start processing a batch job
   */
  preflightStart(
    jobId: string,
    allowedStatuses: readonly string[] = ['draft', 'paused']
  ): { success: boolean; error?: string } {
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

  async startJob(jobId: string): Promise<void> {
    if (this._isProcessing) {
      throw new Error('Queue is already processing a job')
    }
    if (!comfyuiManager.isConnected) {
      throw new Error('Not connected to ComfyUI server')
    }

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

    try {
      await this.processJob(jobId)
    } catch (error) {
      log.error('Job execution error:', error)
      batchJobRepo.updateStatus(jobId, 'failed')
    } finally {
      this._isProcessing = false
      this._currentJobId = null
      setBatchMode(false)
      this.sendStatusToRenderer()
    }
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
      comfyuiManager.restClient.interrupt().catch((e) => {
        log.debug('[Queue] ComfyUI interrupt failed during cancel:', e)
      })
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

    let completedCount = (job.completed_tasks as number) || 0
    let failedCount = (job.failed_tasks as number) || 0
    const totalTasks = (job.total_tasks as number) || 0

    // ETA tracking — limited to moving average window to avoid O(n²) accumulation
    const taskDurations: number[] = []
    const CHUNK_SIZE = TASK_CHUNK_SIZE
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

    // Determine execution mode: lazy (has snapshot) or legacy (pre-created tasks)
    const hasSnapshot = !!job.module_data_snapshot
    let moduleDataSnapshot: ModuleDataSnapshot | null = null
    if (hasSnapshot) {
      moduleDataSnapshot = parseRequiredJson<ModuleDataSnapshot>(
        job.module_data_snapshot as string,
        'Batch module snapshot',
        isModuleDataSnapshot,
        'Batch module snapshot must be an array'
      )
    }

    if (hasSnapshot && moduleDataSnapshot) {
      // Lazy expansion: generate tasks on-the-fly
      let startIndex = completedCount + failedCount

      while (startIndex < totalTasks) {
        const generatedTasks = expandBatchToTasksChunk(
          jobConfig,
          moduleDataSnapshot,
          startIndex,
          CHUNK_SIZE
        )
        if (generatedTasks.length === 0) break

        for (const genTask of generatedTasks) {
          while (this._isPaused) {
            await this.sleep(PAUSE_CHECK_INTERVAL_MS)
            if (this._isCancelled) break
          }
          if (this._isCancelled) break

          // Create a single task row just-in-time
          const taskId = batchTaskRepo.createSingle({
            job_id: jobId,
            prompt_data: JSON.stringify(genTask.promptData),
            sort_order: genTask.sortOrder,
            metadata: JSON.stringify(genTask.metadata)
          })

          const taskRecord: Record<string, unknown> = {
            id: taskId,
            prompt_data: JSON.stringify(genTask.promptData),
            metadata: JSON.stringify(genTask.metadata),
            retry_count: 0
          }

          await executeTrackedTask(taskRecord)
        }

        startIndex = completedCount + failedCount
        if (this._isCancelled) break

        // Periodically clear prompt_data from completed tasks to free DB space
        chunksSinceLastClear++
        if (chunksSinceLastClear >= CLEAR_PROMPT_DATA_CHUNK_INTERVAL) {
          batchTaskRepo.clearPromptDataForCompleted(jobId)
          chunksSinceLastClear = 0
        }
      }
    } else {
      // Legacy mode: process pre-created tasks from DB
      while (true) {
        const tasks = batchTaskRepo.listByJobPending(jobId, CHUNK_SIZE)
        if (tasks.length === 0) break

        for (const task of tasks) {
          while (this._isPaused) {
            await this.sleep(PAUSE_CHECK_INTERVAL_MS)
            if (this._isCancelled) break
          }
          if (this._isCancelled) break

          await executeTrackedTask(task)
        }

        if (this._isCancelled) break
      }
    }

    if (!this._isCancelled) {
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

        retryCount++
        task.retry_count = retryCount
        batchTaskRepo.updateStatus(taskId, 'retrying', { error_message: taskError.message })
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

    batchTaskRepo.updateStatus(taskId, 'running')

    // Clone the workflow and inject prompt data
    const workflowJson = structuredClone(baseApiJson)
    injectPromptData(workflowJson, promptData)

    // Submit to ComfyUI
    const result = await comfyuiManager.restClient.queuePrompt(
      workflowJson,
      comfyuiManager.clientId
    )
    const promptId = result.prompt_id

    batchTaskRepo.updateStatus(taskId, 'running', { comfyui_prompt_id: promptId })

    // Wait for completion via polling history
    const historyResult = await this.waitForCompletion(promptId)

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
        target
      })

      if (target.imageRecords.length === 0) {
        throw new Error(`ComfyUI prompt ${promptId} completed without output images`)
      }

      withTransaction(() => {
        for (const imageRecord of target.imageRecords) {
          imageRepo.create(imageRecord)
        }
        batchTaskRepo.updateStatus(taskId, 'completed', { result_path: target.savedPaths[0] })
      })
    } catch (error) {
      for (const failure of cleanupPartialOutputFiles(target.savedPaths)) {
        log.warn(`[QueueManager] Failed to remove partial output ${failure.path}:`, failure.error)
      }
      throw error
    } finally {
      // Clean up ComfyUI history to free server memory, including failed download/persistence attempts.
      try {
        await comfyuiManager.restClient.deleteFromHistory([promptId])
      } catch (error) {
        log.debug('[QueueManager] Failed to clear ComfyUI history after task attempt:', error)
      }
    }
  }

  /**
   * Wait for ComfyUI prompt completion using WebSocket events (primary)
   * with REST polling as fallback when WebSocket is disconnected.
   */
  private async waitForCompletion(
    promptId: string,
    timeoutMs = TASK_EXECUTION_TIMEOUT_MS
  ): Promise<{ outputs: Record<string, unknown> } | null> {
    const ws = comfyuiManager.webSocket

    if (ws.isConnected) {
      // Primary: WebSocket event-based detection (no polling overhead)
      return this.waitForCompletionViaWebSocket(promptId, timeoutMs)
    } else {
      // Fallback: REST polling with longer interval
      return this.waitForCompletionViaPolling(promptId, timeoutMs)
    }
  }

  /**
   * WebSocket-based completion detection — zero polling overhead.
   * Listens for executionComplete/executionError events matching our promptId.
   */
  private waitForCompletionViaWebSocket(
    promptId: string,
    timeoutMs: number
  ): Promise<{ outputs: Record<string, unknown> } | null> {
    return new Promise((resolve, reject) => {
      const ws = comfyuiManager.webSocket
      let timer: ReturnType<typeof setTimeout> | null = null
      let cancelTimer: ReturnType<typeof setInterval> | null = null
      let settled = false

      const cleanup = (): void => {
        if (settled) return
        settled = true
        ws.removeListener('executionComplete', onComplete)
        ws.removeListener('executionError', onError)
        ws.removeListener('disconnected', onDisconnect)
        if (timer) clearTimeout(timer)
        if (cancelTimer) clearInterval(cancelTimer)
      }

      const onComplete = (data: { promptId: string }): void => {
        if (data.promptId !== promptId) return
        cleanup()
        // Fetch outputs from history (single request, not polling)
        comfyuiManager.restClient
          .getHistoryEntry(promptId)
          .then((entry) => {
            if (entry) {
              const e = entry as { outputs?: Record<string, unknown> }
              resolve(e.outputs ? { outputs: e.outputs } : null)
            } else {
              resolve(null)
            }
          })
          .catch(() => resolve(null))
      }

      const onError = (data: { promptId: string; message: string }): void => {
        if (data.promptId !== promptId) return
        cleanup()
        reject(new Error(`ComfyUI execution error: ${data.message}`))
      }

      const onDisconnect = (): void => {
        // WebSocket dropped — fall back to REST polling for this prompt
        cleanup()
        this.waitForCompletionViaPolling(promptId, timeoutMs).then(resolve).catch(reject)
      }

      ws.on('executionComplete', onComplete)
      ws.on('executionError', onError)
      ws.on('disconnected', onDisconnect)

      // Timeout
      timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for prompt ${promptId}`))
      }, timeoutMs)

      // Periodically check if job was cancelled
      cancelTimer = setInterval(() => {
        if (this._isCancelled) {
          cleanup()
          reject(new Error('Cancelled'))
        }
      }, PAUSE_CHECK_INTERVAL_MS)
    })
  }

  /**
   * REST polling fallback — used when WebSocket is unavailable.
   * Polls at 5-second intervals to minimize server load.
   */
  private async waitForCompletionViaPolling(
    promptId: string,
    timeoutMs: number
  ): Promise<{ outputs: Record<string, unknown> } | null> {
    const startTime = Date.now()
    const POLL_INTERVAL = COMPLETION_POLL_INTERVAL_MS

    while (Date.now() - startTime < timeoutMs) {
      if (this._isCancelled) throw new Error('Cancelled')

      try {
        const history = await comfyuiManager.restClient.getHistory(promptId)
        if (history && history[promptId]) {
          const entry = history[promptId] as {
            status?: { status_str?: string; completed: boolean }
            outputs?: Record<string, unknown>
          }

          if (entry.status?.status_str === 'error') {
            throw new Error('ComfyUI execution error')
          }

          if (entry.status?.completed && entry.outputs) {
            return { outputs: entry.outputs }
          }

          if (entry.outputs && Object.keys(entry.outputs).length > 0) {
            return { outputs: entry.outputs }
          }
        }
      } catch (e) {
        if ((e as Error).message === 'ComfyUI execution error') throw e
      }

      await this.sleep(POLL_INTERVAL)
    }

    throw new Error(`Timeout waiting for prompt ${promptId}`)
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
