import { ofetch } from 'ofetch'
import { COMFYUI_PING_TIMEOUT_MS, COMFYUI_REQUEST_TIMEOUT_MS } from '../../constants'
import log from '../../logger'
import type {
  ComfyUIPromptRequest,
  ComfyUIPromptResponse,
  ComfyUIQueueResponse,
  ComfyUIHistoryEntry,
  ComfyUISystemStats,
  ComfyUIObjectInfo
} from './types'

interface HistoryRequestOptions {
  timeout?: number
  signal?: AbortSignal
}

export class ComfyUIClient {
  private baseUrl: string

  constructor(host: string = 'localhost', port: number = 8188) {
    this.baseUrl = `http://${host}:${port}`
  }

  setServer(host: string, port: number): void {
    this.baseUrl = `http://${host}:${port}`
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  /** Check if the server is reachable */
  async ping(): Promise<boolean> {
    try {
      await ofetch(`${this.baseUrl}/system_stats`, { timeout: COMFYUI_PING_TIMEOUT_MS })
      return true
    } catch (error) {
      log.debug('[ComfyUI] Ping failed:', error)
      return false
    }
  }

  /** Get system statistics (GPU, memory, etc.) */
  async getSystemStats(): Promise<ComfyUISystemStats> {
    return await ofetch(`${this.baseUrl}/system_stats`)
  }

  /** Get available node types and their configurations */
  async getObjectInfo(): Promise<ComfyUIObjectInfo> {
    return await ofetch(`${this.baseUrl}/object_info`)
  }

  /** Get object info for a specific node type */
  async getNodeInfo(nodeType: string): Promise<Record<string, unknown> | null> {
    try {
      const info = await ofetch(`${this.baseUrl}/object_info/${nodeType}`)
      return info
    } catch (error) {
      log.debug(`[ComfyUI] Failed to load node info for "${nodeType}":`, error)
      return null
    }
  }

  /** Queue a prompt for execution */
  async queuePrompt(
    prompt: Record<string, unknown>,
    clientId?: string
  ): Promise<ComfyUIPromptResponse> {
    const body: ComfyUIPromptRequest = {
      prompt: prompt as Record<string, import('./types').ComfyUINode>,
      client_id: clientId
    }
    return await ofetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      body,
      retry: 0,
      timeout: COMFYUI_REQUEST_TIMEOUT_MS
    })
  }

  /** Get the current queue status */
  async getQueue(): Promise<ComfyUIQueueResponse> {
    return await ofetch(`${this.baseUrl}/queue`)
  }

  /** Get execution history */
  async getHistory(
    promptId?: string,
    options?: HistoryRequestOptions
  ): Promise<Record<string, ComfyUIHistoryEntry>> {
    const url = promptId ? `${this.baseUrl}/history/${promptId}` : `${this.baseUrl}/history`
    return await ofetch(url, { timeout: COMFYUI_REQUEST_TIMEOUT_MS, ...options, retry: 0 })
  }

  /** Get a specific history entry */
  async getHistoryEntry(
    promptId: string,
    options?: HistoryRequestOptions
  ): Promise<ComfyUIHistoryEntry | null> {
    const history = await this.getHistory(promptId, options)
    return history[promptId] || null
  }

  /** Download a generated image */
  async getImage(
    filename: string,
    subfolder: string = '',
    type: string = 'output'
  ): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type })
    const response = await ofetch(`${this.baseUrl}/view?${params.toString()}`, {
      responseType: 'arrayBuffer',
      timeout: COMFYUI_REQUEST_TIMEOUT_MS
    })
    return Buffer.from(response)
  }

  /** Upload an image to ComfyUI */
  async uploadImage(
    imageBuffer: Buffer,
    filename: string,
    subfolder: string = '',
    overwrite: boolean = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(imageBuffer)])
    formData.append('image', blob, filename)
    if (subfolder) formData.append('subfolder', subfolder)
    formData.append('overwrite', overwrite ? 'true' : 'false')

    return await ofetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: formData
    })
  }

  /** Interrupt the current execution */
  async interrupt(): Promise<void> {
    await ofetch(`${this.baseUrl}/interrupt`, { method: 'POST' })
  }

  /** Delete items from the queue */
  async deleteFromQueue(ids: string[]): Promise<void> {
    await ofetch(`${this.baseUrl}/queue`, {
      method: 'POST',
      body: { delete: ids }
    })
  }

  /** Clear the entire queue */
  async clearQueue(): Promise<void> {
    await ofetch(`${this.baseUrl}/queue`, {
      method: 'POST',
      body: { clear: true }
    })
  }

  /** Delete items from history */
  async deleteFromHistory(ids: string[]): Promise<void> {
    await ofetch(`${this.baseUrl}/history`, {
      method: 'POST',
      timeout: COMFYUI_REQUEST_TIMEOUT_MS,
      retry: 0,
      body: { delete: ids }
    })
  }

  /** Clear entire history */
  async clearHistory(): Promise<void> {
    await ofetch(`${this.baseUrl}/history`, {
      method: 'POST',
      body: { clear: true }
    })
  }

  /** Get list of available models (checkpoints) from object_info */
  async getAvailableModels(): Promise<{
    checkpoints: string[]
    loras: string[]
    vaes: string[]
    upscaleModels: string[]
    samplers: string[]
    schedulers: string[]
  }> {
    const objectInfo = await this.getObjectInfo()
    const options = (nodeType: string, inputName: string): string[] => {
      const values = objectInfo[nodeType]?.input?.required?.[inputName]?.[0]
      return Array.isArray(values) ? (values as string[]) : []
    }

    return {
      checkpoints: options('CheckpointLoaderSimple', 'ckpt_name'),
      loras: options('LoraLoader', 'lora_name'),
      vaes: options('VAELoader', 'vae_name'),
      upscaleModels: options('UpscaleModelLoader', 'model_name'),
      samplers: options('KSampler', 'sampler_name'),
      schedulers: options('KSampler', 'scheduler')
    }
  }
}
