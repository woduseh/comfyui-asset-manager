// IPC input validation utilities
// Protects against malicious or malformed input from the renderer process

/** Allowed settings keys that can be written via SETTINGS_SET */
const ALLOWED_SETTINGS_KEYS = new Set([
  'comfyui_host',
  'comfyui_port',
  'output_directory',
  'language',
  'theme',
  'output_pattern',
  'filename_pattern',
  'max_retries',
  'auto_save_interval',
  'mcp_enabled',
  'mcp_port',
  'batch.maxRetries',
  'output.directory'
])

export function validateString(val: unknown, maxLen = 10000): string {
  if (typeof val !== 'string') throw new Error('Expected string')
  if (val.length > maxLen) throw new Error(`String exceeds max length (${maxLen})`)
  return val
}

export function validateId(val: unknown): string {
  const s = validateString(val, 100)
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error('Invalid ID format')
  return s
}

export function validatePositiveInt(val: unknown): number {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
    throw new Error('Expected non-negative integer')
  }
  return val
}

export function validateRating(val: unknown): number {
  if (typeof val !== 'number' || val < 0 || val > 5) {
    throw new Error('Rating must be between 0 and 5')
  }
  return val
}

export function validateSettingsKey(key: unknown): string {
  const s = validateString(key, 100)
  if (!ALLOWED_SETTINGS_KEYS.has(s)) {
    throw new Error(`Unknown settings key: ${s}`)
  }
  return s
}

export function validateStringArray(val: unknown, maxLen = 1000): string[] {
  if (!Array.isArray(val)) throw new Error('Expected array')
  if (val.length > maxLen) throw new Error(`Array exceeds max length (${maxLen})`)
  return val.map((item) => validateId(item))
}

/** Validate JSON parse result has expected shape for prompt variants */
export function validatePromptVariants(
  raw: unknown
): Record<string, { prompt: string; negative: string }> {
  if (!raw || typeof raw !== 'string' || raw === '{}') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const result: Record<string, { prompt: string; negative: string }> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'prompt' in value &&
      'negative' in value &&
      typeof (value as Record<string, unknown>).prompt === 'string' &&
      typeof (value as Record<string, unknown>).negative === 'string'
    ) {
      result[key] = {
        prompt: (value as { prompt: string }).prompt,
        negative: (value as { negative: string }).negative
      }
    }
  }
  return result
}
