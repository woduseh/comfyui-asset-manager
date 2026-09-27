import { BrowserWindow } from 'electron'
import { ComfyUIClient } from './client'
import { ComfyUIWebSocket } from './websocket'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc-contract'
import log from '../../logger'

/**
 * Singleton manager that coordinates the ComfyUI REST client and WebSocket connection.
 * Forwards WebSocket events to the renderer via IPC.
 */
export interface ComfyUIExecution {
  readonly client: ComfyUIClient
  readonly webSocket: ComfyUIWebSocket
  readonly clientId: string
  readonly serverUrl: string
  release(): void
}

class ComfyUIManager {
  private client: ComfyUIClient
  private ws: ComfyUIWebSocket
  private _isConnected = false
  private connectionRevision = 0
  private execution: ComfyUIExecution | null = null

  constructor() {
    this.client = new ComfyUIClient()
    this.ws = new ComfyUIWebSocket()
    this.setupWebSocketForwarding()
  }

  get isConnected(): boolean {
    return this._isConnected
  }

  get restClient(): ComfyUIClient {
    return this.client
  }

  get webSocket(): ComfyUIWebSocket {
    return this.ws
  }

  get clientId(): string {
    return this.ws.clientId
  }

  acquireExecution(): ComfyUIExecution {
    if (!this.isConnected) throw new Error('Not connected to ComfyUI server')
    if (this.execution) throw new Error('A ComfyUI execution is already active')
    const context: ComfyUIExecution = {
      client: this.client,
      webSocket: this.ws,
      clientId: this.ws.clientId,
      serverUrl: this.client.serverUrl,
      release: () => {
        if (this.execution === context) this.execution = null
      }
    }
    this.execution = context
    return context
  }

  private assertServerChangeAllowed(serverUrl: string): void {
    if (this.execution && this.execution.serverUrl !== serverUrl) {
      throw new Error(
        'Cannot change the ComfyUI server while a batch is executing; reconnect to the same server or stop the batch first'
      )
    }
  }

  async connect(host: string, port: number): Promise<boolean> {
    const candidate = new ComfyUIClient(host, port)
    this.assertServerChangeAllowed(candidate.serverUrl)
    const revision = ++this.connectionRevision
    const reachable = await candidate.ping()
    if (revision !== this.connectionRevision) return false
    // A batch may have started while this connection probe was in flight.
    this.assertServerChangeAllowed(candidate.serverUrl)
    if (!reachable) return false
    this.ws.disconnect()
    this.client = candidate
    this.ws.setServer(host, port)
    this.ws.connect()
    this._isConnected = true
    return true
  }

  disconnect(): void {
    this.connectionRevision++
    this.ws.disconnect()
    this._isConnected = false
    this.sendToRenderer(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, false)
  }

  private setupWebSocketForwarding(): void {
    this.ws.on('connected', () => {
      this._isConnected = true
      this.sendToRenderer(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, true)
    })

    this.ws.on('disconnected', () => {
      this._isConnected = false
      this.sendToRenderer(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, false)
    })

    this.ws.on('error', (error) => {
      this._isConnected = false
      log.warn('[ComfyUIWebSocket] Error:', error)
      this.sendToRenderer(IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED, false)
    })
  }

  private sendToRenderer<K extends IpcEventChannel>(channel: K, data: IpcEventPayload<K>): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }
}

// Singleton instance
export const comfyuiManager = new ComfyUIManager()
