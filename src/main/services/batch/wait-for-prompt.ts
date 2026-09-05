import type { EventEmitter } from 'events'
import { COMPLETION_POLL_INTERVAL_MS, PAUSE_CHECK_INTERVAL_MS } from '../../constants'
import type { ComfyUIHistoryEntry } from '../comfyui/types'

export class PromptExecutionError extends Error {}
export class PromptOutcomeUnknownError extends Error {}
export class PromptWaitCancelledError extends Error {
  constructor() {
    super('Cancelled')
  }
}

/** Events only wake reconciliation; persisted server history decides the outcome. */
export function waitForPrompt(options: {
  client: {
    getHistoryEntry(
      id: string,
      options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<ComfyUIHistoryEntry | null>
  }
  webSocket: EventEmitter
  promptId: string
  timeoutMs: number
  pollIntervalMs?: number
  isCancelled: () => boolean
}): Promise<{ outputs: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const { client, webSocket, promptId, isCancelled } = options
    const interval = options.pollIntervalMs ?? COMPLETION_POLL_INTERVAL_MS
    const deadline = Date.now() + options.timeoutMs
    const controller = new AbortController()
    let settled = false
    let inFlight = false
    let wakePending = false
    let lastError: unknown
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const eventNames = ['executionComplete', 'executionError', 'executionInterrupted']

    const finish = (error?: Error, entry?: ComfyUIHistoryEntry): void => {
      if (settled) return
      settled = true
      clearTimeout(pollTimer)
      clearTimeout(deadlineTimer)
      clearInterval(cancelTimer)
      for (const event of eventNames) webSocket.removeListener(event, onPromptEvent)
      webSocket.removeListener('disconnected', wake)
      controller.abort()
      if (error) reject(error)
      else resolve({ outputs: entry!.outputs })
    }

    const unknown = (): void =>
      finish(
        new PromptOutcomeUnknownError(
          `Unable to confirm outcome of prompt ${promptId} before deadline${lastError instanceof Error ? `: ${lastError.message}` : ''}`
        )
      )

    const reconcile = async (): Promise<void> => {
      if (settled) return
      if (isCancelled()) {
        finish(new PromptWaitCancelledError())
        return
      }
      if (Date.now() >= deadline) {
        unknown()
        return
      }
      inFlight = true
      wakePending = false
      try {
        const entry = await client.getHistoryEntry(promptId, {
          timeout: Math.max(1, deadline - Date.now()),
          signal: controller.signal
        })
        if (settled) return
        if (isCancelled()) {
          finish(new PromptWaitCancelledError())
          return
        }
        if (Date.now() >= deadline) {
          unknown()
          return
        }
        if (entry?.status?.status_str === 'error') {
          finish(new PromptExecutionError(`ComfyUI execution error for prompt ${promptId}`))
        } else if (entry?.status?.completed === true) {
          finish(undefined, entry)
        }
      } catch (error) {
        lastError = error
      } finally {
        inFlight = false
        if (!settled) {
          pollTimer = setTimeout(
            () => {
              void reconcile()
            },
            wakePending ? 0 : interval
          )
        }
      }
    }

    function wake(): void {
      if (settled) return
      if (inFlight) {
        wakePending = true
        return
      }
      clearTimeout(pollTimer)
      void reconcile()
    }

    function onPromptEvent(data: { promptId: string }): void {
      if (data.promptId === promptId) wake()
    }

    for (const event of eventNames) webSocket.on(event, onPromptEvent)
    webSocket.on('disconnected', wake)
    const deadlineTimer = setTimeout(unknown, Math.max(0, options.timeoutMs))
    const cancelTimer = setInterval(
      () => {
        if (isCancelled()) finish(new PromptWaitCancelledError())
      },
      Math.min(PAUSE_CHECK_INTERVAL_MS, interval)
    )
    wake()
  })
}
