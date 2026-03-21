// Centralized constants — extracted from inline magic numbers across the codebase

// === ComfyUI WebSocket ===
export const WS_RECONNECT_INTERVAL_MS = 3000
export const WS_MAX_RECONNECT_INTERVAL_MS = 30000
export const WS_BACKOFF_MULTIPLIER = 1.5

// === ComfyUI REST Client ===
export const COMFYUI_PING_TIMEOUT_MS = 5000

// === ComfyUI Preview ===
export const PREVIEW_THROTTLE_MS = 500

// === Batch Queue ===
export const TASK_CHUNK_SIZE = 50
export const PAUSE_CHECK_INTERVAL_MS = 1000
export const TASK_EXECUTION_TIMEOUT_MS = 600_000 // 10 minutes
export const COMPLETION_POLL_INTERVAL_MS = 5000
export const MAX_DUPLICATE_FILE_SUFFIX = 999
export const MAX_DURATION_SAMPLES = 50 // Moving average window for ETA calculation
export const CLEAR_PROMPT_DATA_CHUNK_INTERVAL = 5 // Clear completed prompt_data every N chunks

// === MCP Server ===
export const DEFAULT_MCP_PORT = 39464
export const MAX_MCP_SESSIONS = 10
export const MCP_SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const MCP_CLEANUP_INTERVAL_MS = 60_000

// === Database ===
export const DB_SAVE_DEBOUNCE_MS = 1000
export const DB_SAVE_DEBOUNCE_BATCH_MS = 10_000 // Longer debounce during batch processing

// === Tags ===
export const DANBOORU_REQUEST_TIMEOUT_MS = 5000

// === Window ===
export const WINDOW_DEFAULT_WIDTH = 1400
export const WINDOW_DEFAULT_HEIGHT = 900
export const WINDOW_MIN_WIDTH = 1000
export const WINDOW_MIN_HEIGHT = 700
