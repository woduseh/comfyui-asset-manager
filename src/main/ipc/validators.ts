import { extname, isAbsolute } from 'path'

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

export function validateAbsolutePath(val: unknown, allowedExtensions?: readonly string[]): string {
  const filePath = validateString(val, 4096)
  if (!isAbsolute(filePath)) {
    throw new Error('Expected absolute path')
  }

  if (allowedExtensions && allowedExtensions.length > 0) {
    const extension = extname(filePath).toLowerCase()
    const normalizedAllowed = allowedExtensions.map((item) => item.toLowerCase())
    if (!normalizedAllowed.includes(extension)) {
      throw new Error('Invalid file extension')
    }
  }

  return filePath
}

export type GallerySortBy = 'created_at' | 'rating' | 'file_size'
export type GallerySortOrder = 'asc' | 'desc'

export interface ValidatedGalleryQuery {
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

const GALLERY_SORT_FIELDS = {
  created_at: true,
  rating: true,
  file_size: true
} as const

const GALLERY_SORT_ORDERS = {
  asc: true,
  desc: true
} as const

function isGallerySortBy(val: string): val is GallerySortBy {
  return Object.prototype.hasOwnProperty.call(GALLERY_SORT_FIELDS, val)
}

function isGallerySortOrder(val: string): val is GallerySortOrder {
  return Object.prototype.hasOwnProperty.call(GALLERY_SORT_ORDERS, val)
}

function validateRequiredPositiveInt(val: unknown, fieldName: string): number {
  const num = validatePositiveInt(val)
  if (num < 1) {
    throw new Error(`Gallery ${fieldName} must be a positive integer`)
  }
  return num
}

export function validateGalleryQuery(val: unknown): ValidatedGalleryQuery {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new Error('Expected gallery query object')
  }

  const raw = val as Record<string, unknown>
  const query: ValidatedGalleryQuery = {
    page: validateRequiredPositiveInt(raw.page, 'page'),
    pageSize: validateRequiredPositiveInt(raw.pageSize, 'page size')
  }

  if (raw.searchText !== undefined) query.searchText = validateString(raw.searchText)
  if (raw.characterName !== undefined) query.characterName = validateString(raw.characterName)
  if (raw.outfitName !== undefined) query.outfitName = validateString(raw.outfitName)
  if (raw.emotionName !== undefined) query.emotionName = validateString(raw.emotionName)
  if (raw.styleName !== undefined) query.styleName = validateString(raw.styleName)
  if (raw.minRating !== undefined) query.minRating = validateRating(raw.minRating)
  if (raw.tags !== undefined) query.tags = validateStringArray(raw.tags)
  if (raw.jobId !== undefined) query.jobId = validateId(raw.jobId)

  if (raw.isFavorite !== undefined) {
    if (typeof raw.isFavorite !== 'boolean') {
      throw new Error('Gallery favorite filter must be boolean')
    }
    query.isFavorite = raw.isFavorite
  }

  if (raw.sortBy !== undefined) {
    const sortBy = validateString(raw.sortBy, 100)
    if (!isGallerySortBy(sortBy)) {
      throw new Error('Invalid gallery sort field')
    }
    query.sortBy = sortBy
  }

  if (raw.sortOrder !== undefined) {
    const sortOrder = validateString(raw.sortOrder, 10)
    if (!isGallerySortOrder(sortOrder)) {
      throw new Error('Invalid gallery sort order')
    }
    query.sortOrder = sortOrder
  }

  return query
}

/** Validate JSON parse result has expected shape for prompt variants */
export function validatePromptVariants(
  raw: unknown
): Record<string, { prompt: string; negative: string }> {
  if (!raw || typeof raw !== 'string' || raw === '{}') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    void error
    // Malformed legacy prompt_variants payloads are treated as empty so edits can still proceed.
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
