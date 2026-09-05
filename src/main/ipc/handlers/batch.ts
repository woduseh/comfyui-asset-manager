import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import {
  validateBatchPreviewInput,
  validateEnum,
  validateId,
  validateStringArray
} from '../validators'
import { BatchJobRepository, BatchTaskRepository } from '../../services/database/repositories'
import { withTransaction } from '../../services/database'
import { batchJobService } from '../../services/batch/batch-job-service'
import { queueManager } from '../../services/batch/queue-manager'
import { calculateTaskCount } from '../../services/batch/task-generator'
import type { BatchConfig, BatchModuleSelection } from '@shared/ipc-contract'

const batchJobRepo = new BatchJobRepository()
const batchTaskRepo = new BatchTaskRepository()

function assertExecutionEvidenceCanBeRemoved(jobId: string): void {
  const counts = batchTaskRepo.countByJobStatus(jobId)
  if (counts.uncertain > 0) {
    throw new Error(
      'This job requires result review; its execution evidence cannot be deleted or rerun'
    )
  }
  if (
    counts.submitting > 0 ||
    counts.running > 0 ||
    (queueManager.isProcessing && queueManager.currentJobId === jobId)
  ) {
    throw new Error(
      'This job still has an active attempt; its execution evidence cannot be removed'
    )
  }
}

export function registerBatchHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BATCH_LIST, (_event, args?: { status?: string }) => {
    if (args?.status !== undefined) {
      validateEnum(
        args.status,
        ['draft', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const,
        'batch status'
      )
    }
    return batchJobRepo.list(args?.status)
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_GET, (_event, { id }: { id: string }) => {
    validateId(id)
    return batchJobRepo.get(id)
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_DELETE, (_event, { id }: { id: string }) => {
    validateId(id)
    assertExecutionEvidenceCanBeRemoved(id)
    batchJobRepo.delete(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_REORDER, (_event, { jobIds }: { jobIds: string[] }) => {
    validateStringArray(jobIds)
    batchJobRepo.reorder(jobIds)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_DELETE_TASKS, (_event, { jobId }: { jobId: string }) => {
    validateId(jobId)
    assertExecutionEvidenceCanBeRemoved(jobId)
    batchTaskRepo.deleteByJob(jobId)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_RERUN, (_event, { id }: { id: string }) => {
    validateId(id)
    assertExecutionEvidenceCanBeRemoved(id)
    const preflight = queueManager.preflightStart(id, ['completed', 'failed', 'cancelled'])
    if (!preflight.success) return preflight

    withTransaction(() => {
      batchTaskRepo.deleteByJob(id)
      batchJobRepo.updateProgress(id, 0, 0)
      batchJobRepo.updateStatus(id, 'draft')
    })
    return queueManager.requestStart(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.BATCH_PREVIEW_COUNT,
    (
      _event,
      {
        moduleSelections,
        countPerCombination
      }: { moduleSelections: BatchModuleSelection[]; countPerCombination: number }
    ) => {
      validateBatchPreviewInput(moduleSelections, countPerCombination)
      return calculateTaskCount(moduleSelections, countPerCombination)
    }
  )

  ipcMain.handle(IPC_CHANNELS.BATCH_CREATE, (_event, config: BatchConfig) => {
    return batchJobService.create(config)
  })

  ipcMain.handle(
    IPC_CHANNELS.BATCH_UPDATE_DRAFT,
    (_event, { id, config }: { id: string; config: BatchConfig }) => {
      validateId(id)
      return batchJobService.updateDraft(id, config)
    }
  )

  ipcMain.handle(IPC_CHANNELS.BATCH_TASKS, (_event, { jobId }: { jobId: string }) => {
    validateId(jobId)
    return batchTaskRepo.listByJob(jobId)
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_START, (_event, { id }: { id: string }) => {
    validateId(id)
    return queueManager.requestStart(id)
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_PAUSE, () => {
    queueManager.pause()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_RESUME, async (_event, { id }: { id: string }) => {
    validateId(id)
    await queueManager.resume(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_CANCEL, (_event, { id }: { id: string }) => {
    validateId(id)
    queueManager.cancel(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.QUEUE_STATUS, () => ({
    isProcessing: queueManager.isProcessing,
    isPaused: queueManager.isPaused,
    currentJobId: queueManager.currentJobId
  }))
}
