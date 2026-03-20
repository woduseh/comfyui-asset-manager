/**
 * Queue Manager & Batch Executor
 *
 * Processes batch tasks sequentially: submits prompts to ComfyUI,
 * monitors via WebSocket, downloads results, and saves to disk.
 */

import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { comfyuiManager } from '../comfyui/manager'
import {
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository,
  WorkflowRepository,
  SettingsRepository
} from '../database/repositories'
import { IPC_CHANNELS } from '../../ipc/channels'
import { resolveOutputPath, expandBatchToTasksChunk } from '../batch/task-generator'
import type { BatchConfig, ModuleDataSnapshot } from '../batch/task-generator'

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
      console.log(`[QueueManager] Recovering interrupted job: ${jobId}`)
      batchTaskRepo.resetRunningTasksByJob(jobId)
      batchJobRepo.updateStatus(jobId, 'paused')
    }
    if (runningJobs.length > 0) {
      console.log(`[QueueManager] Recovered ${runningJobs.length} interrupted job(s)`)
    }
  }

  /**
   * Start processing a batch job
   */
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
    this.sendToRenderer(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, true)

    // Load retry setting
    const retryStr = settingsRepo.get('batch.maxRetries')
    this._maxRetries = retryStr ? parseInt(retryStr) : 3

    batchJobRepo.updateStatus(jobId, 'running')

    try {
      await this.processJob(jobId)
    } catch (error) {
      console.error('Job execution error:', error)
      batchJobRepo.updateStatus(jobId, 'failed')
    } finally {
      this._isProcessing = false
      this._currentJobId = null
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
  async resume(): Promise<void> {
    // Hot resume: currently paused in an active processing loop
    if (this._currentJobId && this._isPaused) {
      this._isPaused = false
      batchJobRepo.updateStatus(this._currentJobId, 'running')
      return
    }

    // Cold resume: no active loop, find a paused job and restart processing
    if (!this._isProcessing) {
      const pausedJobs = batchJobRepo.list('paused')
      if (pausedJobs.length > 0) {
        const jobId = pausedJobs[0].id as string
        console.log(`[QueueManager] Cold resuming job: ${jobId}`)
        this.startJob(jobId).catch((err) => {
          console.error('[QueueManager] Cold resume failed:', err)
        })
      }
    }
  }

  /**
   * Cancel the current job.
   * Supports "hot cancel" (active loop running) and "cold cancel" (stale state after crash).
   */
  cancel(): void {
    // Hot cancel: QueueManager is actively processing
    if (this._currentJobId) {
      this._isCancelled = true
      this._isPaused = false
      batchJobRepo.updateStatus(this._currentJobId, 'cancelled')
      batchTaskRepo.cancelRemainingTasksByJob(this._currentJobId)
      comfyuiManager.restClient.interrupt().catch(() => {})
      return
    }

    // Cold cancel: no active loop, find running/paused job and cancel directly in DB
    if (!this._isProcessing) {
      const staleJobs = [
        ...batchJobRepo.list('running'),
        ...batchJobRepo.list('paused')
      ]
      for (const job of staleJobs) {
        const jobId = job.id as string
        console.log(`[QueueManager] Cold cancelling job: ${jobId}`)
        batchTaskRepo.cancelRemainingTasksByJob(jobId)
        batchJobRepo.updateStatus(jobId, 'cancelled')
      }
    }
  }

  private async processJob(jobId: string): Promise<void> {
    const job = batchJobRepo.get(jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)

    const workflow = workflowRepo.get(job.workflow_id as string)
    if (!workflow) throw new Error(`Workflow not found for job`)

    const apiJson = JSON.parse(workflow.api_json as string)
    const outputRoot = settingsRepo.get('output.directory') || join(process.env.USERPROFILE || '', 'Pictures', 'ComfyUI_Output')
    const jobConfig = JSON.parse(job.config as string) as BatchConfig

    let completedCount = (job.completed_tasks as number) || 0
    let failedCount = (job.failed_tasks as number) || 0
    const totalTasks = (job.total_tasks as number) || 0

    // ETA tracking
    const taskDurations: number[] = []
    const CHUNK_SIZE = 50

    // Determine execution mode: lazy (has snapshot) or legacy (pre-created tasks)
    const hasSnapshot = !!job.module_data_snapshot
    let moduleDataSnapshot: ModuleDataSnapshot | null = null
    if (hasSnapshot) {
      moduleDataSnapshot = JSON.parse(job.module_data_snapshot as string) as ModuleDataSnapshot
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
            await this.sleep(1000)
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

          const taskStartTime = Date.now()

          try {
            await this.processTask(taskRecord, apiJson, jobId, jobConfig as unknown as Record<string, unknown>, outputRoot)
            completedCount++
            taskDurations.push(Date.now() - taskStartTime)
            batchJobRepo.updateProgress(jobId, completedCount, failedCount)

            this.sendTaskCompletedEvent(jobId, taskId, completedCount, totalTasks, taskDurations)
          } catch (error) {
            // Retry once for lazy tasks
            if ((taskRecord.retry_count as number) < this._maxRetries) {
              batchTaskRepo.updateStatus(taskId, 'retrying', {
                error_message: (error as Error).message
              })
              const retryStartTime = Date.now()
              try {
                await this.processTask(taskRecord, apiJson, jobId, jobConfig as unknown as Record<string, unknown>, outputRoot)
                completedCount++
                taskDurations.push(Date.now() - retryStartTime)
              } catch (retryError) {
                failedCount++
                batchTaskRepo.updateStatus(taskId, 'failed', {
                  error_message: (retryError as Error).message
                })
              }
            } else {
              failedCount++
              batchTaskRepo.updateStatus(taskId, 'failed', {
                error_message: (error as Error).message
              })
            }
            batchJobRepo.updateProgress(jobId, completedCount, failedCount)

            const avgDuration = taskDurations.length > 0
              ? taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
              : 0
            const remainingTasks = totalTasks - completedCount - failedCount
            const etaMs = taskDurations.length > 0 ? Math.round(avgDuration * remainingTasks) : undefined

            this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_FAILED, {
              jobId,
              taskId,
              error: (error as Error).message,
              completed: completedCount,
              failed: failedCount,
              total: totalTasks,
              etaMs
            })
          }
        }

        startIndex = completedCount + failedCount
        if (this._isCancelled) break

        // Periodically clear prompt_data from completed tasks to free DB space
        batchTaskRepo.clearPromptDataForCompleted(jobId)
      }
    } else {
      // Legacy mode: process pre-created tasks from DB
      while (true) {
        const tasks = batchTaskRepo.listByJobPending(jobId, CHUNK_SIZE)
        if (tasks.length === 0) break

        for (const task of tasks) {
          while (this._isPaused) {
            await this.sleep(1000)
            if (this._isCancelled) break
          }
          if (this._isCancelled) break

          const taskStartTime = Date.now()

          try {
            await this.processTask(task, apiJson, jobId, jobConfig as unknown as Record<string, unknown>, outputRoot)
            completedCount++
            taskDurations.push(Date.now() - taskStartTime)
            batchJobRepo.updateProgress(jobId, completedCount, failedCount)

            this.sendTaskCompletedEvent(jobId, task.id as string, completedCount, totalTasks, taskDurations)
          } catch (error) {
            const retryCount = (task.retry_count as number) || 0
            if (retryCount < this._maxRetries) {
              batchTaskRepo.updateStatus(task.id as string, 'retrying', {
                error_message: (error as Error).message
              })
              const retryStartTime = Date.now()
              try {
                await this.processTask(task, apiJson, jobId, jobConfig as unknown as Record<string, unknown>, outputRoot)
                completedCount++
                taskDurations.push(Date.now() - retryStartTime)
              } catch (retryError) {
                failedCount++
                batchTaskRepo.updateStatus(task.id as string, 'failed', {
                  error_message: (retryError as Error).message
                })
              }
            } else {
              failedCount++
              batchTaskRepo.updateStatus(task.id as string, 'failed', {
                error_message: (error as Error).message
              })
            }
            batchJobRepo.updateProgress(jobId, completedCount, failedCount)

            const avgDuration = taskDurations.length > 0
              ? taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
              : 0
            const remainingTasks = totalTasks - completedCount - failedCount
            const etaMs = taskDurations.length > 0 ? Math.round(avgDuration * remainingTasks) : undefined

            this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_FAILED, {
              jobId,
              taskId: task.id,
              error: (error as Error).message,
              completed: completedCount,
              failed: failedCount,
              total: totalTasks,
              etaMs
            })
          }
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
    jobId: string, taskId: string, completedCount: number, totalTasks: number, taskDurations: number[]
  ): void {
    const avgDuration = taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
    const remainingTasks = totalTasks - completedCount
    const etaMs = Math.round(avgDuration * remainingTasks)

    this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_COMPLETED, {
      jobId,
      taskId,
      completed: completedCount,
      total: totalTasks,
      etaMs,
      avgTaskDurationMs: Math.round(avgDuration)
    })
  }

  private async processTask(
    task: Record<string, unknown>,
    baseApiJson: Record<string, unknown>,
    jobId: string,
    jobConfig: Record<string, unknown>,
    outputRoot: string
  ): Promise<void> {
    const taskId = task.id as string
    const promptData = JSON.parse(task.prompt_data as string)
    const metadata = JSON.parse(task.metadata as string)

    batchTaskRepo.updateStatus(taskId, 'running')

    // Clone the workflow and inject prompt data
    const workflowJson = JSON.parse(JSON.stringify(baseApiJson))
    this.injectPromptData(workflowJson, promptData)

    // Submit to ComfyUI
    const result = await comfyuiManager.restClient.queuePrompt(
      workflowJson,
      comfyuiManager.clientId
    )
    const promptId = result.prompt_id

    batchTaskRepo.updateStatus(taskId, 'running', { comfyui_prompt_id: promptId })

    // Wait for completion via polling history
    const historyResult = await this.waitForCompletion(promptId)

    // Download result images
    const outputDir = this.resolveAndCreateOutputDir(
      outputRoot,
      jobConfig,
      metadata
    )

    const savedPaths: string[] = []
    if (historyResult?.outputs) {
      for (const nodeOutput of Object.values(historyResult.outputs)) {
        const nodeOut = nodeOutput as { images?: Array<{ filename: string; type: string; subfolder: string }> }
        if (nodeOut.images) {
          for (const img of nodeOut.images) {
            const imageData = await comfyuiManager.restClient.getImage(
              img.filename,
              img.subfolder,
              img.type
            )

            const fileName = this.resolveFileName(
              (jobConfig.fileNamePattern as string) || '{character}_{outfit}_{emotion}_{index}',
              metadata,
              img.filename
            )
            const savePath = this.getUniquePath(join(outputDir, fileName))
            writeFileSync(savePath, Buffer.from(imageData))
            savedPaths.push(savePath)

            // Save to DB
            imageRepo.create({
              task_id: taskId,
              job_id: jobId,
              file_path: savePath,
              file_size: imageData.byteLength,
              generation_params: JSON.stringify({
                seed: promptData.seed,
                promptId
              }),
              prompt_text: promptData.positive,
              negative_text: promptData.negative,
              character_name: metadata.characterName,
              outfit_name: metadata.outfitName,
              emotion_name: metadata.emotionName,
              style_name: metadata.styleName
            })
          }
        }
      }
    }

    batchTaskRepo.updateStatus(taskId, 'completed', {
      result_path: savedPaths[0] || undefined
    })

    // Clean up ComfyUI history to free server memory
    try {
      await comfyuiManager.restClient.deleteFromHistory([promptId])
    } catch {
      // Non-critical: history cleanup failure shouldn't block task completion
    }
  }

  /**
   * Inject prompt/seed data into the workflow JSON
   */
  private injectPromptData(
    workflow: Record<string, unknown>,
    promptData: {
      positive: string
      negative: string
      seed: number
      extraVariables?: Record<string, string | number>
      slotMappings?: Array<{
        nodeId: string
        fieldName: string
        role: string
        action: 'inject' | 'fixed'
        fixedValue: string
        assignedModuleIds?: string[]
        prefixText?: string
        suffixText?: string
      }>
      slotPrompts?: Record<string, string>
      variableOverrides?: Array<{
        nodeId: string
        fieldName: string
        value: string
      }>
    }
  ): void {
    // Slot-based injection (new system)
    if (promptData.slotMappings && promptData.slotMappings.length > 0) {
      for (const slot of promptData.slotMappings) {
        const node = workflow[slot.nodeId] as { inputs?: Record<string, unknown> }
        if (!node?.inputs) continue

        if (slot.action === 'inject') {
          const slotKey = `${slot.nodeId}:${slot.fieldName}`
          // Use per-slot prompt if available, fall back to global
          if (promptData.slotPrompts && promptData.slotPrompts[slotKey]) {
            node.inputs[slot.fieldName] = promptData.slotPrompts[slotKey]
          } else {
            node.inputs[slot.fieldName] =
              slot.role === 'prompt_positive' ? promptData.positive : promptData.negative
          }
        } else if (slot.action === 'fixed') {
          node.inputs[slot.fieldName] = slot.fixedValue
        }
      }

      // Also inject seeds into KSampler nodes
      for (const [, nodeData] of Object.entries(workflow)) {
        const node = nodeData as { class_type?: string; inputs?: Record<string, unknown> }
        if (!node.class_type || !node.inputs) continue
        if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
          if (promptData.seed !== undefined) {
            node.inputs.seed = promptData.seed
            if (node.inputs.noise_seed !== undefined) {
              node.inputs.noise_seed = promptData.seed
            }
          }
        }
      }
    } else {
      // Legacy heuristic injection (backward compatibility)
      for (const [, nodeData] of Object.entries(workflow)) {
        const node = nodeData as { class_type?: string; inputs?: Record<string, unknown> }
        if (!node.class_type || !node.inputs) continue

        switch (node.class_type) {
          case 'CLIPTextEncode': {
            const currentText = node.inputs.text as string
            if (currentText && typeof currentText === 'string') {
              const isNegative =
                currentText.toLowerCase().includes('worst quality') ||
                currentText.toLowerCase().includes('low quality') ||
                currentText.toLowerCase().includes('bad anatomy')
              node.inputs.text = isNegative ? promptData.negative : promptData.positive
            }
            break
          }
          case 'KSampler':
          case 'KSamplerAdvanced':
            if (promptData.seed !== undefined) {
              node.inputs.seed = promptData.seed
              if (node.inputs.noise_seed !== undefined) {
                node.inputs.noise_seed = promptData.seed
              }
            }
            break
        }
      }
    }

    // Apply variable overrides
    if (promptData.variableOverrides && promptData.variableOverrides.length > 0) {
      for (const override of promptData.variableOverrides) {
        const node = workflow[override.nodeId] as { inputs?: Record<string, unknown> }
        if (node && node.inputs) {
          const numVal = Number(override.value)
          node.inputs[override.fieldName] = isNaN(numVal) ? override.value : numVal
        }
      }
    }

    // Apply extra variables
    if (promptData.extraVariables) {
      for (const [, nodeData] of Object.entries(workflow)) {
        const node = nodeData as { class_type?: string; inputs?: Record<string, unknown> }
        if (!node.inputs) continue
        for (const [key, value] of Object.entries(promptData.extraVariables)) {
          if (key in node.inputs) {
            node.inputs[key] = value
          }
        }
      }
    }
  }

  /**
   * Wait for ComfyUI prompt completion using WebSocket events (primary)
   * with REST polling as fallback when WebSocket is disconnected.
   */
  private async waitForCompletion(
    promptId: string,
    timeoutMs = 600000 // 10 minute timeout per image
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
      }, 1000)
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
    const POLL_INTERVAL = 5000

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

  private resolveAndCreateOutputDir(
    outputRoot: string,
    jobConfig: Record<string, unknown>,
    metadata: Record<string, string>
  ): string {
    const pattern = (jobConfig.outputFolderPattern as string) || '{job}/{character}/{outfit}/{emotion}'
    const vars: Record<string, string> = {
      job: (jobConfig.name as string) || 'unnamed',
      character: metadata.characterName || 'default',
      outfit: metadata.outfitName || 'default',
      emotion: metadata.emotionName || 'default',
      style: metadata.styleName || 'default',
      date: new Date().toISOString().split('T')[0]
    }

    const relPath = resolveOutputPath(pattern, vars)
    const fullPath = join(outputRoot, relPath)

    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true })
    }

    return fullPath
  }

  private resolveFileName(
    pattern: string,
    metadata: Record<string, unknown>,
    originalName: string
  ): string {
    const ext = originalName.includes('.') ? '.' + originalName.split('.').pop() : '.png'
    const vars: Record<string, string> = {
      character: (metadata.characterName as string) || 'char',
      outfit: (metadata.outfitName as string) || 'outfit',
      emotion: (metadata.emotionName as string) || 'emotion',
      style: (metadata.styleName as string) || 'style',
      index: String(((metadata.imageIndex as number) || 0) + 1).padStart(4, '0'),
      seed: String(metadata.seed || ''),
      date: new Date().toISOString().split('T')[0]
    }

    let fileName = pattern
    for (const [key, value] of Object.entries(vars)) {
      fileName = fileName.replace(new RegExp(`\\{${key}\\}`, 'g'), value.replace(/[<>:"/\\|?*]/g, '_'))
    }

    return fileName + ext
  }

  /** If filePath already exists, append _001, _002, ... until unique */
  private getUniquePath(filePath: string): string {
    if (!existsSync(filePath)) return filePath

    const dir = dirname(filePath)
    const ext = extname(filePath)
    const name = basename(filePath, ext)

    for (let i = 1; i <= 999; i++) {
      const candidate = join(dir, `${name}_${String(i).padStart(3, '0')}${ext}`)
      if (!existsSync(candidate)) return candidate
    }
    return filePath
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private sendToRenderer(channel: string, data: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  private sendStatusToRenderer(): void {
    this.sendToRenderer('queue:status-changed', {
      isProcessing: this._isProcessing,
      isPaused: this._isPaused,
      currentJobId: this._currentJobId
    })
  }
}

export const queueManager = new QueueManager()
