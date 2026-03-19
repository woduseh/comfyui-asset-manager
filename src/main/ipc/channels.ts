// IPC Channel names - shared constants
export const IPC_CHANNELS = {
  // Connection
  COMFYUI_CONNECT: 'comfyui:connect',
  COMFYUI_DISCONNECT: 'comfyui:disconnect',
  COMFYUI_STATUS: 'comfyui:status',
  COMFYUI_SYSTEM_STATS: 'comfyui:system-stats',

  // Workflows
  WORKFLOW_IMPORT: 'workflow:import',
  WORKFLOW_LIST: 'workflow:list',
  WORKFLOW_GET: 'workflow:get',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_UPDATE: 'workflow:update',

  // Modules
  MODULE_LIST: 'module:list',
  MODULE_GET: 'module:get',
  MODULE_CREATE: 'module:create',
  MODULE_UPDATE: 'module:update',
  MODULE_DELETE: 'module:delete',

  // Module Items
  MODULE_ITEM_LIST: 'module-item:list',
  MODULE_ITEM_CREATE: 'module-item:create',
  MODULE_ITEM_UPDATE: 'module-item:update',
  MODULE_ITEM_DELETE: 'module-item:delete',

  // Characters
  CHARACTER_LIST: 'character:list',
  CHARACTER_GET: 'character:get',
  CHARACTER_CREATE: 'character:create',
  CHARACTER_UPDATE: 'character:update',
  CHARACTER_DELETE: 'character:delete',

  // Batch
  BATCH_CREATE: 'batch:create',
  BATCH_LIST: 'batch:list',
  BATCH_GET: 'batch:get',
  BATCH_START: 'batch:start',
  BATCH_PAUSE: 'batch:pause',
  BATCH_RESUME: 'batch:resume',
  BATCH_CANCEL: 'batch:cancel',
  BATCH_DELETE: 'batch:delete',

  // Gallery
  GALLERY_LIST: 'gallery:list',
  GALLERY_GET: 'gallery:get',
  GALLERY_RATE: 'gallery:rate',
  GALLERY_FAVORITE: 'gallery:favorite',
  GALLERY_DELETE: 'gallery:delete',
  GALLERY_EXPORT: 'gallery:export',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',

  // Dialog
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_OPEN_DIRECTORY: 'dialog:open-directory',

  // Events (main → renderer)
  QUEUE_PROGRESS: 'queue:progress',
  QUEUE_TASK_COMPLETED: 'queue:task-completed',
  QUEUE_TASK_FAILED: 'queue:task-failed',
  QUEUE_JOB_COMPLETED: 'queue:job-completed',
  COMFYUI_CONNECTION_CHANGED: 'comfyui:connection-changed',
  COMFYUI_PREVIEW: 'comfyui:preview'
} as const
