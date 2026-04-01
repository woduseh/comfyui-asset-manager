import { MAX_DURATION_SAMPLES } from '../../constants'
import { isJsonObject, safeJsonParse } from '../../utils/safe-json'
import type { BatchConfig, GeneratedTask, ModuleDataSnapshot } from './task-generator'

export type TaskPromptData = GeneratedTask['promptData']
export type TaskMetadata = GeneratedTask['metadata']

export function isBatchConfig(value: unknown): value is BatchConfig {
  return (
    isJsonObject(value) &&
    typeof value.name === 'string' &&
    typeof value.workflowId === 'string' &&
    Array.isArray(value.moduleSelections) &&
    typeof value.countPerCombination === 'number' &&
    (value.seedMode === 'random' ||
      value.seedMode === 'fixed' ||
      value.seedMode === 'incremental') &&
    typeof value.outputFolderPattern === 'string' &&
    typeof value.fileNamePattern === 'string'
  )
}

export function isModuleDataSnapshot(value: unknown): value is ModuleDataSnapshot {
  return Array.isArray(value)
}

export function isTaskPromptData(value: unknown): value is TaskPromptData {
  return (
    isJsonObject(value) &&
    typeof value.positive === 'string' &&
    typeof value.negative === 'string' &&
    typeof value.seed === 'number' &&
    (value.extraVariables === undefined || isJsonObject(value.extraVariables)) &&
    (value.slotMappings === undefined || Array.isArray(value.slotMappings)) &&
    (value.slotPrompts === undefined || isJsonObject(value.slotPrompts)) &&
    (value.variableOverrides === undefined || Array.isArray(value.variableOverrides))
  )
}

export function isTaskMetadata(value: unknown): value is TaskMetadata {
  return (
    isJsonObject(value) &&
    (value.characterName === undefined || typeof value.characterName === 'string') &&
    (value.outfitName === undefined || typeof value.outfitName === 'string') &&
    (value.emotionName === undefined || typeof value.emotionName === 'string') &&
    (value.styleName === undefined || typeof value.styleName === 'string') &&
    (value.artistName === undefined || typeof value.artistName === 'string') &&
    typeof value.combinationIndex === 'number' &&
    typeof value.imageIndex === 'number' &&
    typeof value.totalInCombination === 'number'
  )
}

export function parseRequiredJson<T>(
  input: string | null | undefined,
  context: string,
  validate: (value: unknown) => value is T,
  invalidShapeMessage: string
): T {
  const parsed = safeJsonParse<T>(input, {
    context,
    validate,
    invalidShapeMessage
  })

  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  return parsed.value
}

export function pushDuration(durations: number[], value: number): void {
  durations.push(value)
  if (durations.length > MAX_DURATION_SAMPLES) {
    durations.shift()
  }
}

export function computeEta(durations: number[], remainingTasks: number): number | undefined {
  if (durations.length === 0) {
    return undefined
  }

  const avgDuration = durations.reduce((sum, duration) => sum + duration, 0) / durations.length
  return Math.round(avgDuration * remainingTasks)
}

export function resolveFileName(
  pattern: string,
  metadata: TaskMetadata,
  seed: number,
  originalName: string
): string {
  const ext = originalName.includes('.') ? '.' + originalName.split('.').pop() : '.png'
  const vars: Record<string, string> = {
    character: metadata.characterName || 'char',
    outfit: metadata.outfitName || 'outfit',
    emotion: metadata.emotionName || 'emotion',
    style: metadata.styleName || 'style',
    index: String((metadata.imageIndex || 0) + 1).padStart(4, '0'),
    seed: String(seed || ''),
    date: new Date().toISOString().split('T')[0]
  }

  let fileName = pattern
  for (const [key, value] of Object.entries(vars)) {
    fileName = fileName.replace(
      new RegExp(`\\{${key}\\}`, 'g'),
      value.replace(/[<>:"/\\|?*]/g, '_')
    )
  }

  return fileName + ext
}
