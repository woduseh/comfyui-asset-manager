import { EventEmitter, once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient } from '../../../../src/main/services/comfyui/client'
import { ComfyUIWebSocket } from '../../../../src/main/services/comfyui/websocket'
import {
  PromptExecutionError,
  PromptOutcomeUnknownError,
  PromptWaitCancelledError,
  waitForPrompt
} from '../../../../src/main/services/batch/wait-for-prompt'
import { deferred, FakeComfyUIServer } from '../../../helpers/fake-comfyui'
import type { ComfyUIHistoryEntry } from '../../../../src/main/services/comfyui/types'

vi.mock('../../../../src/main/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('prompt reconciliation against a real loopback ComfyUI server', () => {
  let server: FakeComfyUIServer
  let client: ComfyUIClient
  let webSocket: ComfyUIWebSocket
  let promptId: string
  beforeEach(async () => {
    server = await FakeComfyUIServer.start()
    client = new ComfyUIClient(server.host, server.port)
    webSocket = new ComfyUIWebSocket(server.host, server.port)
    webSocket.on('error', () => {
      /* Outcome is verified through reconciliation. */
    })
    const connected = once(webSocket, 'connected')
    webSocket.connect()
    await connected
    promptId = (await client.queuePrompt({}, webSocket.clientId)).prompt_id
  })
  afterEach(async () => {
    webSocket.disconnect()
    await server.close()
  })
  const options = (): Parameters<typeof waitForPrompt>[0] => ({
    client,
    webSocket,
    promptId,
    timeoutMs: 1000,
    pollIntervalMs: 5,
    isCancelled: () => false
  })

  it('finds completion already emitted before the waiter registered', async () => {
    const event = once(webSocket, 'executionComplete')
    server.complete(promptId)
    await event
    expect(await waitForPrompt(options())).toEqual({
      outputs: server.history.get(promptId)!.outputs
    })
    expect(webSocket.listenerCount('executionComplete')).toBe(0)
  })

  it('waits for persisted completed history despite duplicate events and incomplete outputs', async () => {
    server.complete(promptId)
    server.history.get(promptId)!.status.completed = false
    const firstRead = deferred()
    const release = deferred()
    let reads = 0
    server.onHistory = async () => {
      reads++
      if (reads === 1) {
        firstRead.resolve()
        await release.promise
      }
    }
    const result = waitForPrompt(options())
    let settled = false
    void result.then(() => {
      settled = true
    })
    await firstRead.promise
    const duplicate = once(webSocket, 'executionComplete')
    server.send({ type: 'executing', data: { node: null, prompt_id: promptId } })
    server.send({ type: 'executing', data: { node: null, prompt_id: promptId } })
    await duplicate
    expect(settled).toBe(false)
    const secondRead = deferred()
    server.onHistory = () => {
      secondRead.resolve()
    }
    release.resolve()
    await secondRead.promise
    expect(settled).toBe(false)
    server.complete(promptId)
    expect((await result).outputs).toEqual(server.history.get(promptId)!.outputs)
  })

  it('keeps polling across disconnection and transient history failure', async () => {
    let reads = 0
    const failed = deferred()
    server.onHistory = () => {
      if (++reads === 1) {
        failed.resolve()
        throw new Error('Injected history outage')
      }
    }
    const result = waitForPrompt(options())
    await failed.promise
    server.disconnectClients()
    server.complete(promptId)
    expect((await result).outputs).toEqual(server.history.get(promptId)!.outputs)
  })

  it('takes failure from history, not an unverified WebSocket error', async () => {
    server.complete(promptId)
    server.history.get(promptId)!.status = { status_str: 'error', completed: false }
    await expect(waitForPrompt(options())).rejects.toBeInstanceOf(PromptExecutionError)
  })
})

describe('prompt waiter bounded lifetime and races', () => {
  afterEach(() => vi.useRealTimers())
  const entry: ComfyUIHistoryEntry = {
    prompt: [0, 'p', {}, {}],
    outputs: {},
    status: { completed: true, status_str: 'success' }
  }

  it('uses one deadline across disconnects and aborts a hung history request', async () => {
    vi.useFakeTimers()
    const webSocket = new EventEmitter()
    const gate = deferred<ComfyUIHistoryEntry | null>()
    const getHistoryEntry = vi.fn(() => gate.promise)
    const result = waitForPrompt({
      client: { getHistoryEntry },
      webSocket,
      promptId: 'p',
      timeoutMs: 100,
      pollIntervalMs: 5,
      isCancelled: () => false
    })
    const assertion = expect(result).rejects.toBeInstanceOf(PromptOutcomeUnknownError)
    await vi.advanceTimersByTimeAsync(70)
    webSocket.emit('disconnected')
    await vi.advanceTimersByTimeAsync(30)
    await assertion
    expect(getHistoryEntry).toHaveBeenCalledTimes(1)
    expect(
      (getHistoryEntry.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal
        .aborted
    ).toBe(true)
    gate.resolve(entry)
    await Promise.resolve()
    expect(webSocket.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancellation wins over a late successful history response and removes every listener', async () => {
    vi.useFakeTimers()
    const webSocket = new EventEmitter()
    const gate = deferred<ComfyUIHistoryEntry | null>()
    let cancelled = false
    const result = waitForPrompt({
      client: { getHistoryEntry: () => gate.promise },
      webSocket,
      promptId: 'p',
      timeoutMs: 100,
      pollIntervalMs: 5,
      isCancelled: () => cancelled
    })
    const assertion = expect(result).rejects.toBeInstanceOf(PromptWaitCancelledError)
    cancelled = true
    gate.resolve(entry)
    await assertion
    expect(webSocket.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores unrelated events, coalesces duplicate wakeups, and treats WS error as a hint', async () => {
    vi.useFakeTimers()
    const webSocket = new EventEmitter()
    const gate = deferred<ComfyUIHistoryEntry | null>()
    const getHistoryEntry = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce(entry)
    const result = waitForPrompt({
      client: { getHistoryEntry },
      webSocket,
      promptId: 'p',
      timeoutMs: 100,
      pollIntervalMs: 50,
      isCancelled: () => false
    })
    webSocket.emit('executionComplete', { promptId: 'old' })
    webSocket.emit('executionError', { promptId: 'p', message: 'unverified' })
    webSocket.emit('executionInterrupted', { promptId: 'p' })
    webSocket.emit('executionComplete', { promptId: 'p' })
    expect(getHistoryEntry).toHaveBeenCalledTimes(1)
    gate.resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(await result).toEqual({ outputs: {} })
    expect(getHistoryEntry).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
