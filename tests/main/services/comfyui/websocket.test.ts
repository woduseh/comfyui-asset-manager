import { beforeEach, describe, expect, it, vi } from 'vitest'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0

  readyState = MockWebSocket.CONNECTING
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>()

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const existing = this.handlers.get(event) || []
    existing.push(handler)
    this.handlers.set(event, existing)
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) || []) {
      handler(...args)
    }
  }

  removeAllListeners(): void {
    this.handlers.clear()
  }

  close(): void {
    this.readyState = 3
  }
}

vi.mock('ws', () => ({
  default: MockWebSocket
}))

vi.mock('uuid', () => ({
  v4: () => 'client-1'
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

beforeEach(() => {
  vi.resetModules()
  MockWebSocket.instances = []
})

describe('ComfyUIWebSocket', () => {
  it('emits an error when it receives invalid JSON', async () => {
    const { ComfyUIWebSocket } = await import('../../../../src/main/services/comfyui/websocket')
    const client = new ComfyUIWebSocket()
    const errors: Error[] = []
    client.on('error', (error) => errors.push(error))

    client.connect()
    const ws = MockWebSocket.instances[0]
    ws.emit('message', Buffer.from('{'), false)

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('WebSocket message is not valid JSON')
  })
})

describe('ComfyUIManager', () => {
  it('registers a websocket error listener', async () => {
    const { comfyuiManager } = await import('../../../../src/main/services/comfyui/manager')

    expect(comfyuiManager.webSocket.listenerCount('error')).toBeGreaterThan(0)
  })
})
