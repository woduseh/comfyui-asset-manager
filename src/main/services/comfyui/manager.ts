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
class ComfyUIManager {
  private client: ComfyUIClient
  private ws: ComfyUIWebSocket
  private _isConnected = false

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

  async connect(host: string, port: number): Promise<boolean> {
    this.client.setServer(host, port)
    this.ws.setServer(host, port)

    const reachable = await this.client.ping()
    if (!reachable) {
      this._isConnected = false
      return false
    }

    this.ws.connect()
    this._isConnected = true
    return true
  }

  disconnect(): void {
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
