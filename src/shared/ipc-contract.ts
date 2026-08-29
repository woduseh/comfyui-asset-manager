import { IPC_CHANNELS } from './ipc-channels'

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

export interface WorkflowRecord extends Record<string, unknown> {
  id: string
  name: string
  description: string
  category: 'generation' | 'upscale' | 'detailer' | 'custom'
  api_json: string
  ui_json: string | null
  variables: string
  thumbnail: Uint8Array | null
  created_at: string
  updated_at: string
}

export interface WorkflowVariableRecord extends Record<string, unknown> {
  id: string
  workflow_id: string
  node_id: string
  field_name: string
  display_name: string
  var_type: string
  default_val: string | null
  description: string | null
  role: string
}

export interface PromptModuleRecord extends Record<string, unknown> {
  id: string
  name: string
  type: ModuleType
  description: string | null
  is_template: number
  parent_id: string | null
  created_at: string
  updated_at: string
}

export interface ModuleItemRecord extends Record<string, unknown> {
  id: string
  module_id: string
  name: string
  prompt: string
  negative: string
  weight: number
  sort_order: number
  metadata: string
  thumbnail: Uint8Array | null
  enabled: number
  prompt_variants: string | Record<string, PromptVariant>
}

export type BatchJobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BatchJobRecord extends Record<string, unknown> {
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

export type BatchTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying'

export interface BatchTaskRecord extends Record<string, unknown> {
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

export interface GeneratedImageRecord extends Record<string, unknown> {
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

export interface BatchModuleSelection {
  moduleId: string
  moduleType: string
  selectedItemIds: string[]
}

export interface BatchSlotMapping {
  variableId: string
  nodeId: string
  fieldName: string
  role: string
  action: 'inject' | 'fixed'
  fixedValue: string
  assignedModuleIds: string[]
  prefixModuleIds: string[]
  prefixText: string
  userPrefixText?: string
  suffixText: string
  promptVariant?: string
}

export interface BatchConfig {
  name: string
  description?: string
  workflowId: string
  moduleSelections: BatchModuleSelection[]
  countPerCombination: number
  seedMode: 'random' | 'fixed' | 'incremental'
  fixedSeed?: number
  outputFolderPattern: string
  fileNamePattern: string
  extraVariables?: Record<string, string | number>
  slotMappings?: BatchSlotMapping[]
  variableOverrides?: Array<{ nodeId: string; fieldName: string; value: string }>
  pipelineConfig?: {
    steps: Array<{ workflowId: string; variableMappings: Record<string, string> }>
  }
}

export type BatchJobConfig = BatchConfig

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

export interface ComfyUIResources {
  checkpoints: string[]
  loras: string[]
  vaes: string[]
  upscaleModels: string[]
  samplers: string[]
  schedulers: string[]
}

export interface ComfyUIStatus {
  connected: boolean
  host: string
  port: number
  systemStats?: ComfyUISystemStats
}

export interface QueueProgress {
  promptId: string
  node: string
  value: number
  max: number
}

export interface QueueStatus {
  isProcessing: boolean
  isPaused: boolean
  currentJobId: string | null
}

export interface McpStatus {
  isRunning: boolean
  port: number
  url: string
  authRequired: boolean
}

export interface McpAuthStatus {
  required: boolean
  token: string
}

export interface McpConfigStatus {
  claudeCode: boolean
  copilotCli: boolean
  geminiCli: boolean
  codexCli: boolean
  authReady: {
    claudeCode: boolean
    copilotCli: boolean
    geminiCli: boolean
    codexCli: boolean
  }
  configPath: string
}

export interface DashboardStats {
  totalImages: number
  favoriteCount: number
  totalJobs: number
  completedJobs: number
  totalWorkflows: number
  totalModules: number
  recentImages: Record<string, unknown>[]
}

export type ActionResult = { success: true } | { success: false; error: string }
export type FileActionResult = { success: true } | { success: false; error: string }
export type McpStartResult =
  | { success: true; url: string; port: number }
  | { success: false; error: string }
export type McpSetupResult =
  | { success: true; configPath: string }
  | { success: false; error: string }
export type McpRemoveResult =
  | { success: true; removed: boolean }
  | { success: false; error: string }

export interface IpcCall<Args, Result> {
  args: Args
  result: Result
}

export interface IpcInvokeContract {
  [IPC_CHANNELS.COMFYUI_CONNECT]: IpcCall<{ host: string; port: number }, boolean>
  [IPC_CHANNELS.COMFYUI_DISCONNECT]: IpcCall<undefined, boolean>
  [IPC_CHANNELS.COMFYUI_STATUS]: IpcCall<undefined, { connected: boolean; clientId: string }>
  [IPC_CHANNELS.COMFYUI_SYSTEM_STATS]: IpcCall<undefined, ComfyUISystemStats | null>
  [IPC_CHANNELS.COMFYUI_MODELS]: IpcCall<undefined, ComfyUIResources | null>

  [IPC_CHANNELS.WORKFLOW_IMPORT]: IpcCall<
    undefined,
    { id: string; name: string; category: string; variableCount: number } | { error: string } | null
  >
  [IPC_CHANNELS.WORKFLOW_LIST]: IpcCall<{ category?: string } | undefined, WorkflowRecord[]>
  [IPC_CHANNELS.WORKFLOW_GET]: IpcCall<{ id: string }, WorkflowRecord | null>
  [IPC_CHANNELS.WORKFLOW_DELETE]: IpcCall<{ id: string }, boolean>
  [IPC_CHANNELS.WORKFLOW_UPDATE]: IpcCall<{ id: string; data: Record<string, unknown> }, boolean>
  [IPC_CHANNELS.WORKFLOW_VARIABLES]: IpcCall<{ workflowId: string }, WorkflowVariableRecord[]>
  [IPC_CHANNELS.WORKFLOW_SET_VARIABLES]: IpcCall<
    {
      workflowId: string
      variables: Array<{
        node_id: string
        field_name: string
        display_name: string
        var_type: string
        default_val?: string
        description?: string
      }>
    },
    boolean
  >
  [IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_ROLE]: IpcCall<
    { variableId: string; role: string },
    boolean
  >
  [IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_VALUE]: IpcCall<
    { variableId: string; value: string },
    boolean
  >

  [IPC_CHANNELS.MODULE_LIST]: IpcCall<{ type?: string } | undefined, PromptModuleRecord[]>
  [IPC_CHANNELS.MODULE_GET]: IpcCall<{ id: string }, PromptModuleRecord | null>
  [IPC_CHANNELS.MODULE_CREATE]: IpcCall<
    { name: string; type: string; description?: string; parent_id?: string },
    string
  >
  [IPC_CHANNELS.MODULE_UPDATE]: IpcCall<{ id: string; data: Record<string, unknown> }, boolean>
  [IPC_CHANNELS.MODULE_DELETE]: IpcCall<{ id: string }, boolean>
  [IPC_CHANNELS.MODULE_EXPORT]: IpcCall<{ moduleId: string }, string | null>
  [IPC_CHANNELS.MODULE_IMPORT_DATA]: IpcCall<
    { jsonData: string },
    { id: string; name: string } | { error: string }
  >

  [IPC_CHANNELS.MODULE_ITEM_LIST]: IpcCall<{ moduleId: string }, ModuleItemRecord[]>
  [IPC_CHANNELS.MODULE_ITEM_CREATE]: IpcCall<
    {
      module_id: string
      name: string
      prompt: string
      negative?: string
      weight?: number
      sort_order?: number
      metadata?: string
      prompt_variants?: Record<string, PromptVariant> | string
    },
    string
  >
  [IPC_CHANNELS.MODULE_ITEM_UPDATE]: IpcCall<{ id: string; data: Record<string, unknown> }, boolean>
  [IPC_CHANNELS.MODULE_ITEM_DELETE]: IpcCall<{ id: string }, boolean>
  [IPC_CHANNELS.MODULE_ITEM_REORDER]: IpcCall<{ itemIds: string[] }, boolean>

  [IPC_CHANNELS.CHARACTER_LIST]: IpcCall<undefined, Record<string, unknown>[]>
  [IPC_CHANNELS.CHARACTER_GET]: IpcCall<{ id: string }, Record<string, unknown> | null>
  [IPC_CHANNELS.CHARACTER_CREATE]: IpcCall<
    { name: string; base_prompt: string; negative_prompt?: string; metadata?: string },
    string
  >
  [IPC_CHANNELS.CHARACTER_UPDATE]: IpcCall<{ id: string; data: Record<string, unknown> }, boolean>
  [IPC_CHANNELS.CHARACTER_DELETE]: IpcCall<{ id: string }, boolean>

  [IPC_CHANNELS.BATCH_CREATE]: IpcCall<BatchConfig, { jobId: string; totalTasks: number }>
  [IPC_CHANNELS.BATCH_UPDATE_DRAFT]: IpcCall<
    { id: string; config: BatchConfig },
    { jobId: string; totalTasks: number }
  >
  [IPC_CHANNELS.BATCH_LIST]: IpcCall<{ status?: string } | undefined, BatchJobRecord[]>
  [IPC_CHANNELS.BATCH_GET]: IpcCall<{ id: string }, BatchJobRecord | null>
  [IPC_CHANNELS.BATCH_START]: IpcCall<{ id: string }, ActionResult>
  [IPC_CHANNELS.BATCH_PAUSE]: IpcCall<undefined, boolean>
  [IPC_CHANNELS.BATCH_RESUME]: IpcCall<{ id: string }, boolean>
  [IPC_CHANNELS.BATCH_CANCEL]: IpcCall<{ id: string }, boolean>
  [IPC_CHANNELS.BATCH_DELETE]: IpcCall<{ id: string }, boolean>
  [IPC_CHANNELS.BATCH_RERUN]: IpcCall<{ id: string }, ActionResult>
  [IPC_CHANNELS.BATCH_REORDER]: IpcCall<{ jobIds: string[] }, boolean>
  [IPC_CHANNELS.BATCH_DELETE_TASKS]: IpcCall<{ jobId: string }, boolean>
  [IPC_CHANNELS.BATCH_PREVIEW_COUNT]: IpcCall<
    { moduleSelections: BatchModuleSelection[]; countPerCombination: number },
    number
  >
  [IPC_CHANNELS.BATCH_TASKS]: IpcCall<{ jobId: string }, BatchTaskRecord[]>
  [IPC_CHANNELS.QUEUE_STATUS]: IpcCall<undefined, QueueStatus>

  [IPC_CHANNELS.GALLERY_LIST]: IpcCall<
    GalleryQuery,
    { items: GeneratedImageRecord[]; total: number }
  >
  [IPC_CHANNELS.GALLERY_RATE]: IpcCall<{ id: string; rating: number }, boolean>
  [IPC_CHANNELS.GALLERY_FAVORITE]: IpcCall<{ id: string; favorite: boolean }, boolean>
  [IPC_CHANNELS.GALLERY_DELETE]: IpcCall<{ ids: string[] }, boolean>
  [IPC_CHANNELS.GALLERY_COPY_CLIPBOARD]: IpcCall<{ filePath: string }, FileActionResult>
  [IPC_CHANNELS.GALLERY_SHOW_IN_EXPLORER]: IpcCall<{ filePath: string }, boolean>

  [IPC_CHANNELS.PROMPT_PREVIEW]: IpcCall<
    { moduleIds: string[]; variables?: Record<string, string> },
    { positive: string; negative: string }
  >
  [IPC_CHANNELS.DASHBOARD_STATS]: IpcCall<undefined, DashboardStats>

  [IPC_CHANNELS.SETTINGS_GET]: IpcCall<{ key: string }, string | null>
  [IPC_CHANNELS.SETTINGS_SET]: IpcCall<{ key: string; value: string }, boolean>
  [IPC_CHANNELS.SETTINGS_GET_ALL]: IpcCall<undefined, Record<string, string>>

  [IPC_CHANNELS.DIALOG_OPEN_FILE]: IpcCall<
    { filters?: Array<{ name: string; extensions: string[] }> } | undefined,
    string | null
  >
  [IPC_CHANNELS.DIALOG_OPEN_DIRECTORY]: IpcCall<undefined, string | null>

  [IPC_CHANNELS.TERMINAL_CREATE]: IpcCall<{ cols: number; rows: number }, string>
  [IPC_CHANNELS.TERMINAL_INPUT]: IpcCall<{ id: string; data: string }, boolean>
  [IPC_CHANNELS.TERMINAL_RESIZE]: IpcCall<{ id: string; cols: number; rows: number }, boolean>
  [IPC_CHANNELS.TERMINAL_DESTROY]: IpcCall<{ id: string }, boolean>

  [IPC_CHANNELS.MCP_START]: IpcCall<{ port?: number }, McpStartResult>
  [IPC_CHANNELS.MCP_STOP]: IpcCall<undefined, boolean>
  [IPC_CHANNELS.MCP_STATUS]: IpcCall<undefined, McpStatus>
  [IPC_CHANNELS.MCP_AUTH_STATUS]: IpcCall<undefined, McpAuthStatus>
  [IPC_CHANNELS.MCP_AUTH_SET_REQUIRED]: IpcCall<{ required: boolean }, McpAuthStatus>
  [IPC_CHANNELS.MCP_AUTH_ROTATE]: IpcCall<undefined, McpAuthStatus>
  [IPC_CHANNELS.MCP_CONFIG_STATUS]: IpcCall<undefined, McpConfigStatus>
  [IPC_CHANNELS.MCP_SETUP_CLI]: IpcCall<undefined, McpSetupResult>
  [IPC_CHANNELS.MCP_REMOVE_CLI]: IpcCall<undefined, McpRemoveResult>
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcInvokeArgs<K extends IpcInvokeChannel> = IpcInvokeContract[K]['args']
export type IpcInvokeResult<K extends IpcInvokeChannel> = IpcInvokeContract[K]['result']

export type QueueTaskCompletedEvent =
  | { promptId: string }
  | {
      jobId: string
      taskId: string
      completed: number
      total: number
      etaMs: number
      avgTaskDurationMs: number
    }

export type QueueTaskFailedEvent =
  | { promptId: string; nodeId: string; message: string; type: string }
  | {
      jobId: string
      taskId: string
      error: string
      completed: number
      failed: number
      total: number
      etaMs?: number
    }

export interface IpcEventContract {
  [IPC_CHANNELS.COMFYUI_CONNECTION_CHANGED]: boolean
  [IPC_CHANNELS.QUEUE_PROGRESS]: QueueProgress
  [IPC_CHANNELS.QUEUE_TASK_COMPLETED]: QueueTaskCompletedEvent
  [IPC_CHANNELS.QUEUE_TASK_FAILED]: QueueTaskFailedEvent
  [IPC_CHANNELS.QUEUE_JOB_COMPLETED]: { jobId: string }
  [IPC_CHANNELS.QUEUE_STATUS_CHANGED]: QueueStatus
  [IPC_CHANNELS.COMFYUI_PREVIEW]: string
  [IPC_CHANNELS.TERMINAL_DATA]: { id: string; data: string }
  [IPC_CHANNELS.TERMINAL_EXIT]: { id: string; exitCode: number }
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<K extends IpcEventChannel> = IpcEventContract[K]
