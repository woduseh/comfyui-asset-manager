import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import type { ComfyUIWSMessage } from './types'
import {
  WS_RECONNECT_INTERVAL_MS,
  WS_MAX_RECONNECT_INTERVAL_MS,
  WS_BACKOFF_MULTIPLIER
} from '../../constants'
import { safeJsonParse } from '../../utils/safe-json'

export interface ComfyUIWebSocketEvents {
  connected: () => void
  disconnected: () => void
  error: (error: Error) => void
  progress: (data: { promptId: string; node: string; value: number; max: number }) => void
  executionStart: (data: { promptId: string }) => void
  executing: (data: { promptId: string; node: string | null }) => void
  executed: (data: { promptId: string; node: string; output: Record<string, unknown> }) => void
  executionComplete: (data: { promptId: string }) => void
  executionError: (data: {
    promptId: string
    nodeId: string
    message: string
    type: string
  }) => void
  executionInterrupted: (data: { promptId: string }) => void
  preview: (data: Buffer) => void
  queueRemaining: (count: number) => void
}

export class ComfyUIWebSocket extends EventEmitter {
  private ws: WebSocket | null = null
  private host: string
  private port: number
  private _clientId: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectInterval = WS_RECONNECT_INTERVAL_MS
  private maxReconnectInterval = WS_MAX_RECONNECT_INTERVAL_MS
  private currentReconnectInterval: number
  private _isConnected = false
  private shouldReconnect = true

  constructor(host: string = 'localhost', port: number = 8188) {
    super()
    this.host = host
    this.port = port
    this._clientId = uuidv4()
    this.currentReconnectInterval = this.reconnectInterval
  }

  get clientId(): string {
    return this._clientId
  }

  get isConnected(): boolean {
    return this._isConnected
  }

  setServer(host: string, port: number): void {
    this.host = host
    this.port = port
  }

  connect(): void {
    this.shouldReconnect = true
    this.doConnect()
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners()
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
    }

    const url = `ws://${this.host}:${this.port}/ws?clientId=${this._clientId}`

    try {
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this._isConnected = true
        this.currentReconnectInterval = this.reconnectInterval
        this.emit('connected')
      })

      this.ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
        if (isBinary) {
          // Binary data = preview image
          this.emit('preview', Buffer.from(data as ArrayBuffer))
          return
        }

        const parsed = safeJsonParse<ComfyUIWSMessage>(data.toString(), {
          context: 'WebSocket message'
        })
        if (!parsed.ok) {
          this.emit('error', new Error(parsed.error))
          return
        }

        this.handleMessage(parsed.value)
      })

      this.ws.on('close', () => {
        this._isConnected = false
        this.emit('disconnected')
        this.scheduleReconnect()
      })

      this.ws.on('error', (error: Error) => {
        this.emit('error', error)
      })
    } catch (error) {
      this.emit('error', error as Error)
      this.scheduleReconnect()
    }
  }

  private handleMessage(message: ComfyUIWSMessage): void {
    switch (message.type) {
      case 'status':
        this.emit('queueRemaining', message.data.status.exec_info.queue_remaining)
        break

      case 'execution_start':
        this.emit('executionStart', { promptId: message.data.prompt_id })
        break

      case 'progress':
        this.emit('progress', {
          promptId: message.data.prompt_id,
          node: message.data.node,
          value: message.data.value,
          max: message.data.max
        })
        break

      case 'executing':
        if (message.data.node === null) {
          // null node means execution complete
          this.emit('executionComplete', { promptId: message.data.prompt_id })
        } else {
          this.emit('executing', {
            promptId: message.data.prompt_id,
            node: message.data.node
          })
        }
        break

      case 'executed':
        this.emit('executed', {
          promptId: message.data.prompt_id,
          node: message.data.node,
          output: message.data.output
        })
        break

      case 'execution_error':
        this.emit('executionError', {
          promptId: message.data.prompt_id,
          nodeId: message.data.node_id,
          message: message.data.exception_message,
          type: message.data.exception_type
        })
        break

      case 'execution_interrupted':
        this.emit('executionInterrupted', { promptId: message.data.prompt_id })
        break

      case 'execution_cached':
        // Cached nodes, no action needed
        break
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(() => {
      this.doConnect()
      // Exponential backoff
      this.currentReconnectInterval = Math.min(
        this.currentReconnectInterval * WS_BACKOFF_MULTIPLIER,
        this.maxReconnectInterval
      )
    }, this.currentReconnectInterval)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    this._isConnected = false
    this.emit('disconnected')
  }
}
