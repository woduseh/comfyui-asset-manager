import { ofetch } from 'ofetch'
import { COMFYUI_PING_TIMEOUT_MS } from '../../constants'
import log from '../../logger'
import type {
  ComfyUIPromptRequest,
  ComfyUIPromptResponse,
  ComfyUIQueueResponse,
  ComfyUIHistoryEntry,
  ComfyUISystemStats,
  ComfyUIObjectInfo
} from './types'

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
      body
    })
  }

  /** Get the current queue status */
  async getQueue(): Promise<ComfyUIQueueResponse> {
    return await ofetch(`${this.baseUrl}/queue`)
  }

  /** Get execution history */
  async getHistory(promptId?: string): Promise<Record<string, ComfyUIHistoryEntry>> {
    const url = promptId ? `${this.baseUrl}/history/${promptId}` : `${this.baseUrl}/history`
    return await ofetch(url)
  }

  /** Get a specific history entry */
  async getHistoryEntry(promptId: string): Promise<ComfyUIHistoryEntry | null> {
    const history = await this.getHistory(promptId)
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
      responseType: 'arrayBuffer'
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
    const result = {
      checkpoints: [] as string[],
      loras: [] as string[],
      vaes: [] as string[],
      upscaleModels: [] as string[],
      samplers: [] as string[],
      schedulers: [] as string[]
    }

    // Extract checkpoint names
    const ckptLoader = objectInfo['CheckpointLoaderSimple']
    if (ckptLoader?.input?.required?.['ckpt_name']) {
      const options = ckptLoader.input.required['ckpt_name']
      if (Array.isArray(options[0])) {
        result.checkpoints = options[0] as string[]
      }
    }

    // Extract LoRA names
    const loraLoader = objectInfo['LoraLoader']
    if (loraLoader?.input?.required?.['lora_name']) {
      const options = loraLoader.input.required['lora_name']
      if (Array.isArray(options[0])) {
        result.loras = options[0] as string[]
      }
    }

    // Extract VAE names
    const vaeLoader = objectInfo['VAELoader']
    if (vaeLoader?.input?.required?.['vae_name']) {
      const options = vaeLoader.input.required['vae_name']
      if (Array.isArray(options[0])) {
        result.vaes = options[0] as string[]
      }
    }

    // Extract upscale model names
    const upscaleLoader = objectInfo['UpscaleModelLoader']
    if (upscaleLoader?.input?.required?.['model_name']) {
      const options = upscaleLoader.input.required['model_name']
      if (Array.isArray(options[0])) {
        result.upscaleModels = options[0] as string[]
      }
    }

    // Extract sampler names
    const ksampler = objectInfo['KSampler']
    if (ksampler?.input?.required?.['sampler_name']) {
      const options = ksampler.input.required['sampler_name']
      if (Array.isArray(options[0])) {
        result.samplers = options[0] as string[]
      }
    }

    // Extract scheduler names
    if (ksampler?.input?.required?.['scheduler']) {
      const options = ksampler.input.required['scheduler']
      if (Array.isArray(options[0])) {
        result.schedulers = options[0] as string[]
      }
    }

    return result
  }
}
