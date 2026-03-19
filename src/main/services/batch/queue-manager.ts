/**
 * Queue Manager & Batch Executor
 *
 * Processes batch tasks sequentially: submits prompts to ComfyUI,
 * monitors via WebSocket, downloads results, and saves to disk.
 */

import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { comfyuiManager } from '../comfyui/manager'
import {
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository,
  WorkflowRepository,
  SettingsRepository
} from '../database/repositories'
import { IPC_CHANNELS } from '../../ipc/channels'
import { resolveOutputPath } from '../batch/task-generator'

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
  private _currentTaskId: string | null = null
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
      this._currentTaskId = null
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
   * Resume processing
   */
  async resume(): Promise<void> {
    if (!this._currentJobId || !this._isPaused) return
    this._isPaused = false
    batchJobRepo.updateStatus(this._currentJobId, 'running')
    // The processJob loop will continue via the isPaused check
  }

  /**
   * Cancel the current job
   */
  cancel(): void {
    this._isCancelled = true
    this._isPaused = false
    if (this._currentJobId) {
      batchJobRepo.updateStatus(this._currentJobId, 'cancelled')
    }
    // Interrupt current ComfyUI generation
    comfyuiManager.restClient.interrupt().catch(() => {})
  }

  private async processJob(jobId: string): Promise<void> {
    const job = batchJobRepo.get(jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)

    const workflow = workflowRepo.get(job.workflow_id as string)
    if (!workflow) throw new Error(`Workflow not found for job`)

    const apiJson = JSON.parse(workflow.api_json as string)
    const tasks = batchTaskRepo.listByJob(jobId)
    const outputRoot = settingsRepo.get('output.directory') || join(process.env.USERPROFILE || '', 'Pictures', 'ComfyUI_Output')
    const jobConfig = JSON.parse(job.config as string)

    let completedCount = (job.completed_tasks as number) || 0
    let failedCount = (job.failed_tasks as number) || 0

    for (const task of tasks) {
      // Skip already completed/cancelled tasks
      if (task.status === 'completed' || task.status === 'cancelled') continue

      // Wait while paused
      while (this._isPaused) {
        await this.sleep(1000)
        if (this._isCancelled) break
      }
      if (this._isCancelled) break

      this._currentTaskId = task.id as string

      try {
        await this.processTask(
          task,
          apiJson,
          jobId,
          jobConfig,
          outputRoot
        )
        completedCount++
        batchJobRepo.updateProgress(jobId, completedCount, failedCount)

        this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_COMPLETED, {
          jobId,
          taskId: task.id,
          completed: completedCount,
          total: job.total_tasks
        })
      } catch (error) {
        const retryCount = (task.retry_count as number) || 0
        if (retryCount < this._maxRetries) {
          batchTaskRepo.updateStatus(task.id as string, 'retrying', {
            error_message: (error as Error).message
          })
          // Re-add to end of queue... simplified: just retry immediately
          try {
            await this.processTask(task, apiJson, jobId, jobConfig, outputRoot)
            completedCount++
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

        this.sendToRenderer(IPC_CHANNELS.QUEUE_TASK_FAILED, {
          jobId,
          taskId: task.id,
          error: (error as Error).message,
          completed: completedCount,
          failed: failedCount,
          total: job.total_tasks
        })
      }
    }

    if (!this._isCancelled) {
      batchJobRepo.updateStatus(jobId, 'completed')
      this.sendToRenderer(IPC_CHANNELS.QUEUE_JOB_COMPLETED, { jobId })
    }
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
              img.type,
              img.subfolder
            )

            const fileName = this.resolveFileName(
              (jobConfig.fileNamePattern as string) || '{character}_{outfit}_{emotion}_{index}',
              metadata,
              img.filename
            )
            const savePath = join(outputDir, fileName)
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
      result_path: savedPaths[0] || null
    })
  }

  /**
   * Inject prompt/seed data into the workflow JSON
   */
  private injectPromptData(
    workflow: Record<string, unknown>,
    promptData: { positive: string; negative: string; seed: number; extraVariables?: Record<string, string | number> }
  ): void {
    for (const [_nodeId, nodeData] of Object.entries(workflow)) {
      const node = nodeData as { class_type?: string; inputs?: Record<string, unknown> }
      if (!node.class_type || !node.inputs) continue

      switch (node.class_type) {
        case 'CLIPTextEncode': {
          // Check if this is positive or negative by looking at connections
          // Simple heuristic: if text contains negative-like content, it's likely negative
          const currentText = node.inputs.text as string
          if (currentText && typeof currentText === 'string') {
            // Try to detect if this is the positive or negative node
            const isNegative = currentText.toLowerCase().includes('worst quality') ||
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

      // Apply extra variables
      if (promptData.extraVariables) {
        for (const [key, value] of Object.entries(promptData.extraVariables)) {
          if (key in node.inputs) {
            node.inputs[key] = value
          }
        }
      }
    }
  }

  /**
   * Poll ComfyUI history until the prompt is complete
   */
  private async waitForCompletion(
    promptId: string,
    timeoutMs = 600000 // 10 minute timeout per image
  ): Promise<{ outputs: Record<string, unknown> } | null> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      if (this._isCancelled) throw new Error('Cancelled')

      try {
        const history = await comfyuiManager.restClient.getHistory(promptId)
        if (history && history[promptId]) {
          const entry = history[promptId] as { status?: { completed: boolean }; outputs?: Record<string, unknown> }
          if (entry.outputs && Object.keys(entry.outputs).length > 0) {
            return { outputs: entry.outputs }
          }
        }
      } catch {
        // Retry on network error
      }

      await this.sleep(1000)
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
