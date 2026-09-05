import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient } from '../../../../src/main/services/comfyui/client'
import { ComfyUIWebSocket } from '../../../../src/main/services/comfyui/websocket'
import { deferred, FakeComfyUIServer } from '../../../helpers/fake-comfyui'

vi.mock('../../../../src/main/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('ComfyUI protocol fault fixture (real HTTP and WebSocket)', () => {
  let server: FakeComfyUIServer
  let client: ComfyUIClient
  let ws: ComfyUIWebSocket

  beforeEach(async () => {
    server = await FakeComfyUIServer.start()
    client = new ComfyUIClient(server.host, server.port)
    ws = new ComfyUIWebSocket(server.host, server.port)
    ws.on('error', () => {
      /* Connection errors are asserted through protocol state. */
    })
  })

  afterEach(async () => {
    ws.disconnect()
    await server.close()
  })

  it('keeps server acceptance observable when the POST response is lost, without automatic repost', async () => {
    server.onPrompt = () => 'drop'
    await expect(client.queuePrompt({})).rejects.toThrow()
    expect(server.accepted).toHaveLength(1)
    server.complete('prompt-1')
    expect((await client.getHistoryEntry('prompt-1'))?.status.completed).toBe(true)
  })

  it('can deliver duplicate completion before a held POST response and a delayed stale event afterward', async () => {
    const connected = once(ws, 'connected')
    ws.connect()
    await connected
    const release = deferred()
    server.onPrompt = () => release.promise
    const events: string[] = []
    ws.on('executionComplete', ({ promptId }: { promptId: string }) => events.push(promptId))
    const response = client.queuePrompt({}, ws.clientId)
    const accepted = await server.waitForPrompt()
    const first = once(ws, 'executionComplete')
    server.complete(accepted.id)
    await first
    const duplicate = once(ws, 'executionComplete')
    server.send({ type: 'executing', data: { node: null, prompt_id: accepted.id } })
    await duplicate
    expect(events).toEqual([accepted.id, accepted.id])
    release.resolve()
    expect((await response).prompt_id).toBe(accepted.id)
    const stale = once(ws, 'executionComplete')
    server.send({ type: 'executing', data: { node: null, prompt_id: 'old-prompt' } })
    await stale
    expect(events.at(-1)).toBe('old-prompt')
  })

  it('retains REST history while the socket disconnects and isolates a failed second image', async () => {
    const connected = once(ws, 'connected')
    ws.connect()
    await connected
    const { prompt_id: id } = await client.queuePrompt({}, ws.clientId)
    const disconnected = once(ws, 'disconnected')
    server.disconnectClients()
    await disconnected
    server.complete(id, ['first.png', 'second.png'])
    server.failedImages.add('second.png')
    expect(ws.isConnected).toBe(false)
    expect((await client.getHistoryEntry(id))?.outputs['1'].images).toHaveLength(2)
    expect(await client.getImage('first.png')).toEqual(Buffer.from('image:first.png'))
    await expect(client.getImage('second.png')).rejects.toThrow()
    await client.deleteFromHistory([id])
    expect(await client.getHistoryEntry(id)).toBeNull()
  })

  it('aborts a held history request without another HTTP attempt', async () => {
    const started = deferred()
    const release = deferred()
    server.onHistory = async () => {
      started.resolve()
      await release.promise
    }
    const controller = new AbortController()
    const result = client.getHistoryEntry('pending', { timeout: 1000, signal: controller.signal })
    const assertion = expect(result).rejects.toThrow()
    await started.promise
    controller.abort()
    await assertion
    release.resolve()
    expect(server.requests.filter((request) => request.path === '/history/pending')).toHaveLength(1)
  })
})
