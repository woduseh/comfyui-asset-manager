// Shared type definitions for IPC channels between main and renderer

export interface IpcChannels {
  // Connection
  'comfyui:connect': { host: string; port: number }
  'comfyui:disconnect': void
  'comfyui:status': void
  'comfyui:system-stats': void

  // Workflows
  'workflow:import': { filePath: string }
  'workflow:list': void
  'workflow:get': { id: string }
  'workflow:delete': { id: string }
  'workflow:update': { id: string; data: Partial<WorkflowRecord> }

  // Modules
  'module:list': { type?: string }
  'module:get': { id: string }
  'module:create': Omit<PromptModuleRecord, 'id' | 'created_at' | 'updated_at'>
  'module:update': { id: string; data: Partial<PromptModuleRecord> }
  'module:delete': { id: string }

  // Module Items
  'module-item:list': { moduleId: string }
  'module-item:create': Omit<ModuleItemRecord, 'id'>
  'module-item:update': { id: string; data: Partial<ModuleItemRecord> }
  'module-item:delete': { id: string }

  // Characters
  'character:list': void
  'character:get': { id: string }
  'character:create': Omit<CharacterRecord, 'id' | 'created_at'>
  'character:update': { id: string; data: Partial<CharacterRecord> }
  'character:delete': { id: string }

  // Batch
  'batch:create': BatchJobConfig
  'batch:list': { status?: string }
  'batch:get': { id: string }
  'batch:start': { id: string }
  'batch:pause': { id: string }
  'batch:resume': { id: string }
  'batch:cancel': { id: string }
  'batch:delete': { id: string }

  // Gallery
  'gallery:list': GalleryQuery
  'gallery:get': { id: string }
  'gallery:rate': { id: string; rating: number }
  'gallery:favorite': { id: string; favorite: boolean }
  'gallery:delete': { ids: string[] }
  'gallery:export': { ids: string[]; targetDir: string }

  // Settings
  'settings:get': { key: string }
  'settings:set': { key: string; value: string }
  'settings:getAll': void

  // Dialog
  'dialog:open-file': { filters?: { name: string; extensions: string[] }[] }
  'dialog:open-directory': void

  // Terminal
  'terminal:create': { cols: number; rows: number }
  'terminal:input': { id: string; data: string }
  'terminal:resize': { id: string; cols: number; rows: number }
  'terminal:destroy': { id: string }

  // MCP Server
  'mcp:start': { port?: number }
  'mcp:stop': void
  'mcp:status': void
}

// Database record types
export interface WorkflowRecord {
  id: string
  name: string
  description: string
  category: 'generation' | 'upscale' | 'detailer' | 'custom'
  api_json: string
  ui_json: string | null
  variables: string
  thumbnail: Buffer | null
  created_at: string
  updated_at: string
}

export interface WorkflowVariableRecord {
  id: string
  workflow_id: string
  node_id: string
  field_name: string
  display_name: string
  var_type: 'text' | 'number' | 'boolean' | 'seed' | 'image' | 'model' | 'lora'
  default_val: string | null
  description: string | null
}

export interface PromptModuleRecord {
  id: string
  name: string
  type: ModuleType
  description: string | null
  is_template: number
  parent_id: string | null
  created_at: string
  updated_at: string
}

export type ModuleType =
  | 'character'
  | 'outfit'
  | 'emotion'
  | 'style'
  | 'artist'
  | 'quality'
  | 'negative'
  | 'lora'
  | 'custom'

export interface ModuleItemRecord {
  id: string
  module_id: string
  name: string
  prompt: string
  negative: string
  weight: number
  sort_order: number
  metadata: string
  thumbnail: Buffer | null
  enabled: number
}

export interface CharacterRecord {
  id: string
  name: string
  base_prompt: string
  negative_prompt: string
  thumbnail: Buffer | null
  metadata: string
  created_at: string
}

export interface BatchJobRecord {
  id: string
  name: string
  description: string | null
  status: BatchJobStatus
  config: string
  workflow_id: string | null
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  pipeline_config: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type BatchJobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BatchTaskRecord {
  id: string
  job_id: string
  status: BatchTaskStatus
  prompt_data: string
  comfyui_prompt_id: string | null
  result_path: string | null
  error_message: string | null
  retry_count: number
  sort_order: number
  metadata: string
  created_at: string
  completed_at: string | null
}

export type BatchTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying'

export interface GeneratedImageRecord {
  id: string
  task_id: string | null
  job_id: string | null
  file_path: string
  thumbnail_path: string | null
  file_size: number | null
  width: number | null
  height: number | null
  generation_params: string
  prompt_text: string | null
  negative_text: string | null
  rating: number
  is_favorite: number
  tags: string
  character_name: string | null
  outfit_name: string | null
  emotion_name: string | null
  style_name: string | null
  created_at: string
}

export interface PresetRecord {
  id: string
  name: string
  description: string | null
  type: 'batch' | 'module' | 'pipeline' | 'full'
  config: string
  created_at: string
}

export interface SettingRecord {
  key: string
  value: string
}

// Runtime types
export interface BatchJobConfig {
  name: string
  description?: string
  workflowId: string
  moduleSlots: ModuleSlotMapping[]
  matrixSelections: MatrixSelection[]
  countPerCombination: number
  seedMode: 'random' | 'fixed' | 'incremental'
  fixedSeed?: number
  outputPattern: string
  filenamePattern: string
  additionalParams?: Record<string, unknown>
  pipelineId?: string
}

export interface ModuleSlotMapping {
  variableId: string
  moduleId: string
}

export interface MatrixSelection {
  moduleId: string
  selectedItemIds: string[]
}

export interface GalleryQuery {
  page: number
  pageSize: number
  characterName?: string
  outfitName?: string
  emotionName?: string
  styleName?: string
  minRating?: number
  isFavorite?: boolean
  tags?: string[]
  jobId?: string
  sortBy?: 'created_at' | 'rating' | 'file_size'
  sortOrder?: 'asc' | 'desc'
}

export interface ComfyUIStatus {
  connected: boolean
  host: string
  port: number
  systemStats?: {
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
}

export interface QueueProgress {
  promptId: string
  node: string
  value: number
  max: number
}
