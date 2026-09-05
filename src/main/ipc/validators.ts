import { extname, isAbsolute } from 'path'
import {
  MAX_BATCH_COUNT_PER_COMBINATION,
  MAX_BATCH_MODULE_SELECTIONS,
  MAX_BATCH_PIPELINE_STEPS,
  MAX_BATCH_SELECTED_ITEMS,
  MAX_BATCH_SLOT_MAPPINGS,
  MAX_BATCH_TOTAL_TASKS,
  MAX_BATCH_VARIABLE_OVERRIDES,
  MAX_TERMINAL_DIMENSION,
  MAX_TERMINAL_INPUT_LENGTH
} from '../constants'
import type { BatchConfig, BatchModuleSelection } from '@shared/ipc-contract'

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
  'mcp_auth_required',
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
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
    throw new Error('Expected non-negative integer')
  }
  return val
}

export function validateIntegerRange(
  val: unknown,
  min: number,
  max: number,
  fieldName = 'Value'
): number {
  const number = validatePositiveInt(val)
  if (number < min || number > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`)
  }
  return number
}

export function validateBoolean(val: unknown): boolean {
  if (typeof val !== 'boolean') throw new Error('Expected boolean')
  return val
}

export function validateEnum<T extends string>(
  val: unknown,
  allowed: readonly T[],
  fieldName = 'value'
): T {
  const value = validateString(val, 100)
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid ${fieldName}`)
  }
  return value as T
}

function validateObject(val: unknown, fieldName: string): Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new Error(`Expected ${fieldName} object`)
  }
  return val as Record<string, unknown>
}

function rejectUnknownFields(
  data: Record<string, unknown>,
  allowedFields: readonly string[],
  fieldName: string
): void {
  const unknownField = Object.keys(data).find((key) => !allowedFields.includes(key))
  if (unknownField) {
    throw new Error(`Unknown ${fieldName} field: ${unknownField}`)
  }
}

const MODULE_TYPES = [
  'character',
  'outfit',
  'emotion',
  'style',
  'artist',
  'quality',
  'negative',
  'lora',
  'custom'
] as const
const WORKFLOW_CATEGORIES = ['generation', 'upscale', 'detailer', 'custom'] as const
const WORKFLOW_ROLES = ['prompt_positive', 'prompt_negative', 'seed', 'fixed', 'custom'] as const

export function validateWorkflowCategory(val: unknown): string {
  return validateEnum(val, WORKFLOW_CATEGORIES, 'workflow category')
}

export function validateModuleType(val: unknown): string {
  return validateEnum(val, MODULE_TYPES, 'module type')
}

export function validateWorkflowRole(val: unknown): string {
  return validateEnum(val, WORKFLOW_ROLES, 'workflow role')
}

export function validateWorkflowUpdate(val: unknown): void {
  const data = validateObject(val, 'workflow update')
  rejectUnknownFields(
    data,
    ['name', 'description', 'category', 'api_json', 'ui_json', 'variables'],
    'workflow update'
  )
  if (data.name !== undefined) validateString(data.name, 200)
  if (data.description !== undefined) validateString(data.description, 10_000)
  if (data.category !== undefined) validateWorkflowCategory(data.category)
  if (data.api_json !== undefined) validateString(data.api_json, MAX_WORKFLOW_JSON_LENGTH)
  if (data.ui_json !== undefined && data.ui_json !== null) {
    validateString(data.ui_json, MAX_WORKFLOW_JSON_LENGTH)
  }
  if (data.variables !== undefined) validateString(data.variables, MAX_WORKFLOW_JSON_LENGTH)
}

export function validateModuleData(val: unknown, update = false): void {
  const data = validateObject(val, update ? 'module update' : 'module')
  rejectUnknownFields(data, ['name', 'type', 'description', 'parent_id'], 'module')
  if (!update || data.name !== undefined) validateString(data.name, 200)
  if (!update || data.type !== undefined) validateModuleType(data.type)
  if (data.description !== undefined) validateString(data.description, 10_000)
  if (data.parent_id !== undefined && data.parent_id !== null && data.parent_id !== '') {
    validateId(data.parent_id)
  }
}

function validatePromptVariantsPayload(val: unknown): void {
  const parsed =
    typeof val === 'string'
      ? (() => {
          validateString(val, 100_000)
          try {
            return JSON.parse(val) as unknown
          } catch {
            throw new Error('Invalid prompt variants JSON')
          }
        })()
      : val
  const variants = validateObject(parsed, 'prompt variants')
  if (Object.keys(variants).length > 100) {
    throw new Error('Prompt variants exceed maximum entries')
  }
  for (const [key, variant] of Object.entries(variants)) {
    validateString(key, 200)
    const record = validateObject(variant, 'prompt variant')
    rejectUnknownFields(record, ['prompt', 'negative'], 'prompt variant')
    validateString(record.prompt, 100_000)
    validateString(record.negative, 100_000)
  }
}

export function validateModuleItemData(val: unknown, update = false): void {
  const data = validateObject(val, update ? 'module item update' : 'module item')
  rejectUnknownFields(
    data,
    [
      'module_id',
      'name',
      'prompt',
      'negative',
      'weight',
      'sort_order',
      'metadata',
      'prompt_variants',
      ...(update ? ['enabled'] : [])
    ],
    'module item'
  )
  if (!update || data.module_id !== undefined) validateId(data.module_id)
  if (!update || data.name !== undefined) validateString(data.name, 200)
  if (!update || data.prompt !== undefined) validateString(data.prompt, 100_000)
  if (data.negative !== undefined) validateString(data.negative, 100_000)
  if (
    data.weight !== undefined &&
    (typeof data.weight !== 'number' || !Number.isFinite(data.weight))
  ) {
    throw new Error('Invalid module item weight')
  }
  if (data.sort_order !== undefined) validatePositiveInt(data.sort_order)
  if (data.metadata !== undefined) validateString(data.metadata, 100_000)
  if (data.enabled !== undefined) validateIntegerRange(data.enabled, 0, 1, 'Module item enabled')
  if (data.prompt_variants !== undefined) validatePromptVariantsPayload(data.prompt_variants)
}

export function validateCharacterData(val: unknown, update = false): void {
  const data = validateObject(val, update ? 'character update' : 'character')
  rejectUnknownFields(data, ['name', 'base_prompt', 'negative_prompt', 'metadata'], 'character')
  if (!update || data.name !== undefined) validateString(data.name, 200)
  if (!update || data.base_prompt !== undefined) validateString(data.base_prompt, 100_000)
  if (data.negative_prompt !== undefined) validateString(data.negative_prompt, 100_000)
  if (data.metadata !== undefined) validateString(data.metadata, 100_000)
}

export function validateWorkflowVariables(val: unknown): void {
  if (!Array.isArray(val)) throw new Error('Expected workflow variables array')
  if (val.length > 1000) throw new Error('Workflow variables exceed maximum entries')
  for (const variable of val) {
    const data = validateObject(variable, 'workflow variable')
    rejectUnknownFields(
      data,
      ['node_id', 'field_name', 'display_name', 'var_type', 'default_val', 'description', 'role'],
      'workflow variable'
    )
    validateString(data.node_id, 200)
    validateString(data.field_name, 200)
    validateString(data.display_name, 500)
    validateString(data.var_type, 100)
    if (data.default_val !== undefined) validateString(data.default_val, 100_000)
    if (data.description !== undefined) validateString(data.description, 10_000)
    if (data.role !== undefined) validateWorkflowRole(data.role)
  }
}

function validateBatchModuleSelections(val: unknown): asserts val is BatchModuleSelection[] {
  if (!Array.isArray(val)) throw new Error('Expected batch module selections array')
  if (val.length > MAX_BATCH_MODULE_SELECTIONS) {
    throw new Error('Batch module selections exceed maximum entries')
  }
  for (const selection of val) {
    const data = validateObject(selection, 'batch module selection')
    rejectUnknownFields(data, ['moduleId', 'moduleType', 'selectedItemIds'], 'module selection')
    validateId(data.moduleId)
    validateModuleType(data.moduleType)
    validateStringArray(data.selectedItemIds, MAX_BATCH_SELECTED_ITEMS)
  }
}

function validateStringMap(val: unknown, fieldName: string): void {
  const data = validateObject(val, fieldName)
  if (Object.keys(data).length > 500) throw new Error(`${fieldName} exceeds maximum entries`)
  for (const [key, value] of Object.entries(data)) {
    validateString(key, 200)
    validateString(value, 10_000)
  }
}

export function validateBatchConfig(val: unknown): asserts val is BatchConfig {
  const data = validateObject(val, 'batch config')
  rejectUnknownFields(
    data,
    [
      'name',
      'description',
      'workflowId',
      'moduleSelections',
      'countPerCombination',
      'seedMode',
      'fixedSeed',
      'outputFolderPattern',
      'fileNamePattern',
      'extraVariables',
      'slotMappings',
      'variableOverrides',
      'pipelineConfig'
    ],
    'batch config'
  )
  validateString(data.name, 200)
  if (data.description !== undefined) validateString(data.description, 10_000)
  validateId(data.workflowId)
  validateBatchModuleSelections(data.moduleSelections)
  const count = validateIntegerRange(
    data.countPerCombination,
    1,
    MAX_BATCH_COUNT_PER_COMBINATION,
    'Batch count per combination'
  )
  validateEnum(data.seedMode, ['random', 'fixed', 'incremental'] as const, 'seed mode')
  if (data.fixedSeed !== undefined) validatePositiveInt(data.fixedSeed)
  validateOutputFolderPattern(data.outputFolderPattern)
  validateOutputFilePattern(data.fileNamePattern)

  if (data.extraVariables !== undefined) {
    const variables = validateObject(data.extraVariables, 'extra variables')
    if (Object.keys(variables).length > 500) {
      throw new Error('Extra variables exceed maximum entries')
    }
    for (const [key, value] of Object.entries(variables)) {
      validateString(key, 200)
      if (typeof value === 'string') validateString(value, 100_000)
      else if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid extra variable value')
      }
    }
  }

  if (data.slotMappings !== undefined) {
    if (!Array.isArray(data.slotMappings)) throw new Error('Expected slot mappings array')
    if (data.slotMappings.length > MAX_BATCH_SLOT_MAPPINGS) {
      throw new Error('Slot mappings exceed maximum entries')
    }
    for (const slot of data.slotMappings) {
      const mapping = validateObject(slot, 'slot mapping')
      rejectUnknownFields(
        mapping,
        [
          'variableId',
          'nodeId',
          'fieldName',
          'role',
          'action',
          'fixedValue',
          'assignedModuleIds',
          'prefixModuleIds',
          'prefixText',
          'userPrefixText',
          'suffixText',
          'promptVariant'
        ],
        'slot mapping'
      )
      validateId(mapping.variableId)
      validateString(mapping.nodeId, 200)
      validateString(mapping.fieldName, 200)
      validateEnum(
        mapping.role,
        ['prompt_positive', 'prompt_negative'] as const,
        'slot mapping role'
      )
      validateEnum(mapping.action, ['inject', 'fixed'] as const, 'slot mapping action')
      validateString(mapping.fixedValue, 100_000)
      validateStringArray(mapping.assignedModuleIds, MAX_BATCH_MODULE_SELECTIONS)
      validateStringArray(mapping.prefixModuleIds, MAX_BATCH_MODULE_SELECTIONS)
      validateString(mapping.prefixText, 100_000)
      if (mapping.userPrefixText !== undefined) validateString(mapping.userPrefixText, 100_000)
      validateString(mapping.suffixText, 100_000)
      if (mapping.promptVariant !== undefined) validateString(mapping.promptVariant, 200)
    }
  }

  if (data.variableOverrides !== undefined) {
    if (!Array.isArray(data.variableOverrides)) {
      throw new Error('Expected variable overrides array')
    }
    if (data.variableOverrides.length > MAX_BATCH_VARIABLE_OVERRIDES) {
      throw new Error('Variable overrides exceed maximum entries')
    }
    for (const override of data.variableOverrides) {
      const record = validateObject(override, 'variable override')
      rejectUnknownFields(record, ['nodeId', 'fieldName', 'value'], 'variable override')
      validateString(record.nodeId, 200)
      validateString(record.fieldName, 200)
      validateString(record.value, 100_000)
    }
  }

  if (data.pipelineConfig !== undefined) {
    const pipeline = validateObject(data.pipelineConfig, 'pipeline config')
    rejectUnknownFields(pipeline, ['steps'], 'pipeline config')
    if (!Array.isArray(pipeline.steps)) throw new Error('Expected pipeline steps array')
    if (pipeline.steps.length > MAX_BATCH_PIPELINE_STEPS) {
      throw new Error('Pipeline steps exceed maximum entries')
    }
    for (const step of pipeline.steps) {
      const record = validateObject(step, 'pipeline step')
      rejectUnknownFields(record, ['workflowId', 'variableMappings'], 'pipeline step')
      validateId(record.workflowId)
      validateStringMap(record.variableMappings, 'pipeline variable mappings')
    }
  }

  let totalTasks = count
  for (const selection of data.moduleSelections) {
    const dimension = Math.max(1, selection.selectedItemIds.length)
    if (totalTasks > Math.floor(MAX_BATCH_TOTAL_TASKS / dimension)) {
      throw new Error(`Batch exceeds maximum task count (${MAX_BATCH_TOTAL_TASKS})`)
    }
    totalTasks *= dimension
  }
}

function validateOutputFolderPattern(val: unknown): void {
  const pattern = validateString(val, 1000)
  const normalized = pattern.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error('Output folder pattern must stay within the configured output directory')
  }
}

function validateOutputFilePattern(val: unknown): void {
  const pattern = validateString(val, 1000)
  if (pattern === '.' || pattern === '..' || pattern.includes('/') || pattern.includes('\\')) {
    throw new Error('Output filename pattern must not contain directories')
  }
}

export function validateBatchPreviewInput(
  moduleSelections: unknown,
  countPerCombination: unknown
): void {
  validateBatchModuleSelections(moduleSelections)
  validateIntegerRange(
    countPerCombination,
    1,
    MAX_BATCH_COUNT_PER_COMBINATION,
    'Batch count per combination'
  )
}

export function validateTerminalInput(id: unknown, data: unknown): void {
  validateId(id)
  validateString(data, MAX_TERMINAL_INPUT_LENGTH)
}

export function validateTerminalDimensions(cols: unknown, rows: unknown): void {
  validateIntegerRange(cols, 1, MAX_TERMINAL_DIMENSION, 'Terminal columns')
  validateIntegerRange(rows, 1, MAX_TERMINAL_DIMENSION, 'Terminal rows')
}

const MAX_WORKFLOW_JSON_LENGTH = 10_485_760

export function validateRating(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 5) {
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

function validateRequiredPositiveInt(val: unknown, fieldName: string, max: number): number {
  const num = validatePositiveInt(val)
  if (num < 1) {
    throw new Error(`Gallery ${fieldName} must be a positive integer`)
  }
  if (num > max) {
    throw new Error(`Gallery ${fieldName} exceeds maximum value (${max})`)
  }
  return num
}

export function validateGalleryQuery(val: unknown): ValidatedGalleryQuery {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new Error('Expected gallery query object')
  }

  const raw = val as Record<string, unknown>
  const query: ValidatedGalleryQuery = {
    page: validateRequiredPositiveInt(raw.page, 'page', 1_000_000),
    pageSize: validateRequiredPositiveInt(raw.pageSize, 'page size', 500)
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
