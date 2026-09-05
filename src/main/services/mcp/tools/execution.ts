import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { queueManager } from '../../batch/queue-manager'
import { comfyuiManager } from '../../comfyui/manager'
import { SettingsRepository } from '../../database/repositories'
import { batchStatus } from './workflows-batch'
import { jsonError, jsonResult } from './response'

const settings = new SettingsRepository()
const jobId = z.string().trim().min(1).describe('Explicit batch job ID')

function executionState(): Record<string, unknown> {
  return {
    connected: comfyuiManager.isConnected,
    connection_source: 'ComfyUI manager connection state',
    queue: {
      processing: queueManager.isProcessing,
      paused: queueManager.isPaused,
      current_job_id: queueManager.currentJobId
    }
  }
}

function checkedActiveJob(id: string): void {
  if (queueManager.isProcessing && queueManager.currentJobId !== id) {
    throw new Error(`Another batch job is active: ${queueManager.currentJobId}`)
  }
}

function errorResult(error: unknown): ReturnType<typeof jsonError> {
  return jsonError(error instanceof Error ? error.message : String(error))
}

export function registerExecutionTools(server: McpServer): void {
  server.tool(
    'get_execution_status',
    'Read ComfyUI connection and local queue state. With job_id, includes task counts and start preflight. Connection is the manager state, not a fresh network probe. Running-job preflight may correctly report that the queue is busy.',
    { job_id: jobId.optional() },
    async ({ job_id }) => {
      try {
        return jsonResult({
          ...executionState(),
          ...(job_id
            ? {
                batch: batchStatus(job_id),
                start_preflight: queueManager.preflightStart(job_id)
              }
            : {})
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.tool(
    'connect_comfyui',
    'Connect to the ComfyUI host and port already saved in app Settings. No arbitrary address input. Refuses while a batch is processing; already connected is a no-op. On failure, check Settings and server availability.',
    {},
    async () => {
      try {
        if (queueManager.isProcessing)
          throw new Error('Cannot reconnect while a batch is processing')
        if (comfyuiManager.isConnected)
          return jsonResult({ connected: true, already_connected: true })
        const host = settings.get('comfyui_host') ?? 'localhost'
        const port = Number(settings.get('comfyui_port') ?? '8188')
        if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('Invalid ComfyUI host or port in Settings')
        }
        if (!(await comfyuiManager.connect(host, port)))
          throw new Error('Could not connect to the ComfyUI server configured in Settings')
        return jsonResult({ connected: true, already_connected: false })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.tool(
    'control_batch_job',
    'Control an explicitly selected batch: pause stops before subsequent tasks while in-flight work may finish; resume accepts a paused batch, including after restart, but uncertain outcomes must be reconciled first; cancel stops remaining running/paused work while preserving outputs and uncertain submissions. Acceptance is not completion or proof the server stopped: use wait_batch_job and inspect execution_active. Never automatically resubmit uncertain attempts.',
    {
      job_id: jobId,
      action: z.enum(['pause', 'resume', 'cancel']).describe('Requested batch control action')
    },
    async ({ job_id, action }) => {
      try {
        checkedActiveJob(job_id)
        const status = batchStatus(job_id)
        if (action === 'pause') {
          if (!queueManager.isProcessing || queueManager.currentJobId !== job_id) {
            if (status.job.status === 'paused')
              return jsonResult({ action, already_paused: true, ...status })
            throw new Error('Only the active processing batch can be paused')
          }
          if (status.job.status !== 'running' && status.job.status !== 'paused')
            throw new Error('Batch is no longer running')
          queueManager.pause()
          return jsonResult({ action, pause_requested: true, ...batchStatus(job_id) })
        }
        if (action === 'resume') {
          if (status.job.status !== 'paused') throw new Error('Only a paused batch can be resumed')
          await queueManager.resume(job_id)
          return jsonResult({ action, resume_requested: true, ...batchStatus(job_id) })
        }
        if (status.job.status === 'cancelled')
          return jsonResult({ action, already_cancelled: true, ...status })
        if (status.job.status !== 'running' && status.job.status !== 'paused')
          throw new Error('Only a running or paused batch can be cancelled')
        queueManager.cancel(job_id)
        return jsonResult({ action, cancel_requested: true, ...batchStatus(job_id) })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.tool(
    'wait_batch_job',
    'Bounded read-only wait for batch status/count changes, completion, pause or review-required state. Pass the returned cursor as after on follow-up calls. A timeout is not a job failure. Does not resubmit or mutate tasks; prefer this over rapid polling.',
    {
      job_id: jobId,
      timeout_ms: z.number().int().min(0).max(30000).default(10000),
      after: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional()
        .describe('Cursor from a previous wait response')
    },
    async ({ job_id, timeout_ms, after }) => {
      try {
        const started = Date.now()
        let baseline = after
        while (true) {
          const status = batchStatus(job_id)
          const cursor = createHash('sha256').update(JSON.stringify(status)).digest('hex')
          const changed = baseline !== undefined && cursor !== baseline
          const immediate =
            status.terminal || status.requires_review || status.job.status === 'paused'
          const elapsed = Date.now() - started
          if (changed || immediate || elapsed >= timeout_ms) {
            return jsonResult({
              ...status,
              cursor,
              changed,
              timed_out: !changed && !immediate && elapsed >= timeout_ms,
              waited_ms: elapsed
            })
          }
          baseline ??= cursor
          await delay(Math.min(500, timeout_ms - elapsed))
        }
      } catch (error) {
        return errorResult(error)
      }
    }
  )
}
