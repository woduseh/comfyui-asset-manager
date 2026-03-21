// ComfyUI API type definitions

export interface ComfyUIPromptRequest {
  prompt: Record<string, ComfyUINode>
  client_id?: string
  extra_data?: Record<string, unknown>
}

export interface ComfyUINode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title: string }
}

export interface ComfyUIPromptResponse {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface ComfyUIQueueResponse {
  queue_running: Array<[number, string, Record<string, ComfyUINode>, Record<string, unknown>]>
  queue_pending: Array<[number, string, Record<string, ComfyUINode>, Record<string, unknown>]>
}

export interface ComfyUIHistoryEntry {
  prompt: [number, string, Record<string, ComfyUINode>, Record<string, unknown>]
  outputs: Record<
    string,
    {
      images?: Array<{
        filename: string
        subfolder: string
        type: string
      }>
    }
  >
  status: {
    status_str: string
    completed: boolean
  }
}

export interface ComfyUISystemStats {
  system: {
    os: string
    python_version: string
    embedded_python: boolean
  }
  devices: Array<{
    name: string
    type: string
    index: number
    vram_total: number
    vram_free: number
    torch_vram_total: number
    torch_vram_free: number
  }>
}

export interface ComfyUIObjectInfo {
  [nodeType: string]: {
    input: {
      required?: Record<string, unknown[]>
      optional?: Record<string, unknown[]>
    }
    output: string[]
    output_is_list: boolean[]
    output_name: string[]
    name: string
    display_name: string
    description: string
    category: string
  }
}

// WebSocket message types
export type ComfyUIWSMessage =
  | { type: 'status'; data: { status: { exec_info: { queue_remaining: number } }; sid?: string } }
  | { type: 'execution_start'; data: { prompt_id: string } }
  | { type: 'execution_cached'; data: { prompt_id: string; nodes: string[] } }
  | {
      type: 'executing'
      data: { node: string | null; prompt_id: string }
    }
  | {
      type: 'progress'
      data: { value: number; max: number; prompt_id: string; node: string }
    }
  | { type: 'executed'; data: { node: string; output: Record<string, unknown>; prompt_id: string } }
  | {
      type: 'execution_error'
      data: {
        prompt_id: string
        node_id: string
        exception_message: string
        exception_type: string
      }
    }
  | { type: 'execution_interrupted'; data: { prompt_id: string } }

// Known node types for variable extraction
export const VARIABLE_NODE_TYPES: Record<
  string,
  { fields: Array<{ name: string; type: string; displayName: string }> }
> = {
  KSampler: {
    fields: [
      { name: 'seed', type: 'seed', displayName: 'Seed' },
      { name: 'steps', type: 'number', displayName: 'Steps' },
      { name: 'cfg', type: 'number', displayName: 'CFG Scale' },
      { name: 'sampler_name', type: 'text', displayName: 'Sampler' },
      { name: 'scheduler', type: 'text', displayName: 'Scheduler' },
      { name: 'denoise', type: 'number', displayName: 'Denoise' }
    ]
  },
  KSamplerAdvanced: {
    fields: [
      { name: 'noise_seed', type: 'seed', displayName: 'Seed' },
      { name: 'steps', type: 'number', displayName: 'Steps' },
      { name: 'cfg', type: 'number', displayName: 'CFG Scale' },
      { name: 'sampler_name', type: 'text', displayName: 'Sampler' },
      { name: 'scheduler', type: 'text', displayName: 'Scheduler' },
      { name: 'start_at_step', type: 'number', displayName: 'Start Step' },
      { name: 'end_at_step', type: 'number', displayName: 'End Step' }
    ]
  },
  CLIPTextEncode: {
    fields: [{ name: 'text', type: 'text', displayName: 'Prompt Text' }]
  },
  CheckpointLoaderSimple: {
    fields: [{ name: 'ckpt_name', type: 'model', displayName: 'Checkpoint' }]
  },
  LoraLoader: {
    fields: [
      { name: 'lora_name', type: 'lora', displayName: 'LoRA Model' },
      { name: 'strength_model', type: 'number', displayName: 'Model Strength' },
      { name: 'strength_clip', type: 'number', displayName: 'CLIP Strength' }
    ]
  },
  SaveImage: {
    fields: [{ name: 'filename_prefix', type: 'text', displayName: 'Filename Prefix' }]
  },
  EmptyLatentImage: {
    fields: [
      { name: 'width', type: 'number', displayName: 'Width' },
      { name: 'height', type: 'number', displayName: 'Height' },
      { name: 'batch_size', type: 'number', displayName: 'Batch Size' }
    ]
  },
  LatentUpscale: {
    fields: [
      { name: 'upscale_method', type: 'text', displayName: 'Upscale Method' },
      { name: 'width', type: 'number', displayName: 'Width' },
      { name: 'height', type: 'number', displayName: 'Height' }
    ]
  },
  UpscaleModelLoader: {
    fields: [{ name: 'model_name', type: 'model', displayName: 'Upscale Model' }]
  },
  VAELoader: {
    fields: [{ name: 'vae_name', type: 'model', displayName: 'VAE' }]
  }
}
