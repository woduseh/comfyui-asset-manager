// Shared type definitions for IPC channels between main and renderer

export interface IpcChannels {
  // Connection
  'comfyui:connect': { host: string; port: number }
  'comfyui:disconnect': void
  'comfyui:status': void
  'comfyui:system-stats': void
  'comfyui:models': void

  // Workflows
  'workflow:import': { filePath: string }
  'workflow:list': { category?: string }
  'workflow:get': { id: string }
  'workflow:delete': { id: string }
  'workflow:update': { id: string; data: Partial<WorkflowRecord> }
  'workflow:variables': { workflowId: string }
  'workflow:update-variable-role': { variableId: string; role: string }

  // Modules
  'module:list': { type?: string }
  'module:get': { id: string }
  'module:create': Omit<PromptModuleRecord, 'id' | 'created_at' | 'updated_at'>
  'module:update': { id: string; data: Partial<PromptModuleRecord> }
  'module:delete': { id: string }
  'module:export': { moduleId: string }
  'module:import-data': { jsonData: string }

  // Module Items
  'module-item:list': { moduleId: string }
  'module-item:create': Omit<ModuleItemRecord, 'id'>
  'module-item:update': { id: string; data: Partial<ModuleItemRecord> }
  'module-item:delete': { id: string }
  'module-item:reorder': { itemIds: string[] }

  'batch:create': BatchJobConfig
  'batch:list': { status?: string }
  'batch:get': { id: string }
  'batch:start': { id: string }
  'batch:pause': void
  'batch:resume': void
  'batch:cancel': void
  'batch:delete': { id: string }
  'batch:reorder': { jobIds: string[] }
  'batch:rerun': { id: string }
  'batch:delete-tasks': { jobId: string }
  'queue:status': void

  // Gallery
  'gallery:list': GalleryQuery
  'gallery:get': { id: string }
  'gallery:rate': { id: string; rating: number }
  'gallery:favorite': { id: string; favorite: boolean }
  'gallery:delete': { ids: string[] }
  'gallery:export': { ids: string[]; targetDir: string }
  'gallery:copy-clipboard': { filePath: string }
  'gallery:show-in-explorer': { filePath: string }

  // Prompts
  'prompt:preview': { moduleIds: string[]; variables?: Record<string, string> }

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
  'mcp:config-status': void
  'mcp:setup-cli': { targetDir?: string }
  'mcp:remove-cli': { targetDir?: string }
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

export interface PromptVariant {
  prompt: string
  negative: string
}

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
  prompt_variants: string // JSON: Record<string, PromptVariant>
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

export type GallerySortBy = 'created_at' | 'rating' | 'file_size'
export type GallerySortOrder = 'asc' | 'desc'

export interface GalleryQuery {
  page: number
  pageSize: number
  searchText?: string
  characterName?: string
  outfitName?: string
  emotionName?: string
  styleName?: string
  minRating?: number
  isFavorite?: boolean
  tags?: string[]
  jobId?: string
  sortBy?: GallerySortBy
  sortOrder?: GallerySortOrder
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
