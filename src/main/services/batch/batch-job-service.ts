import { notifyBatchChanged } from './changes'
import {
  BatchJobRepository,
  ModuleItemRepository,
  ModuleRepository,
  type BatchJobWriteData
} from '../database/repositories'
import {
  validateBatchConfig,
  validateBatchPreviewInput,
  validatePromptVariants
} from '../../ipc/validators'
import { buildPrompt } from '../prompt/composition-engine'
import type { BatchConfig, BatchModuleSelection } from '@shared/ipc-contract'
import { countTotalTasksFromData, type ModuleDataSnapshot } from './task-generator'

export interface PreparedBatchJob {
  data: BatchJobWriteData
  totalTasks: number
}

interface BatchJobServiceDependencies {
  batchJobRepo: Pick<BatchJobRepository, 'create' | 'updateDraft'>
  moduleRepo: Pick<ModuleRepository, 'get'>
  moduleItemRepo: Pick<ModuleItemRepository, 'list'>
}

export class BatchJobService {
  constructor(private readonly dependencies: BatchJobServiceDependencies) {}

  create(config: BatchConfig): { jobId: string; totalTasks: number } {
    const prepared = this.prepare(config)
    const jobId = this.dependencies.batchJobRepo.create(prepared.data)
    notifyBatchChanged()
    return { jobId, totalTasks: prepared.totalTasks }
  }

  updateDraft(id: string, config: BatchConfig): { jobId: string; totalTasks: number } {
    const prepared = this.prepare(config)
    this.dependencies.batchJobRepo.updateDraft(id, prepared.data)
    notifyBatchChanged()
    return { jobId: id, totalTasks: prepared.totalTasks }
  }

  previewCount(moduleSelections: BatchModuleSelection[], countPerCombination: number): number {
    validateBatchPreviewInput(moduleSelections, countPerCombination)
    return countTotalTasksFromData(
      { moduleSelections, countPerCombination },
      this.resolveModuleData(moduleSelections)
    )
  }

  prepare(config: BatchConfig): PreparedBatchJob {
    validateBatchConfig(config)
    const resolvedConfig = structuredClone(config)

    if (resolvedConfig.slotMappings) {
      for (const slot of resolvedConfig.slotMappings) {
        slot.userPrefixText = slot.prefixText || ''

        if (slot.action === 'inject' && slot.prefixModuleIds?.length) {
          const prefixModules = slot.prefixModuleIds
            .map((moduleId) => {
              const mod = this.dependencies.moduleRepo.get(moduleId)
              const items = this.dependencies.moduleItemRepo.list(moduleId)
              return {
                type: (mod?.type as string) || 'custom',
                items: items
                  .filter((item) => (item.enabled as number) !== 0)
                  .map((item) => {
                    const variants = validatePromptVariants(item.prompt_variants as string)
                    const variant = slot.promptVariant ? variants[slot.promptVariant] : undefined
                    return {
                      prompt: variant?.prompt ?? (item.prompt as string),
                      negative: variant?.negative ?? ((item.negative as string) || ''),
                      weight: (item.weight as number | null) ?? 1.0,
                      enabled: true
                    }
                  })
              }
            })
            .filter((module) => module.items.length > 0)

          if (prefixModules.length > 0) {
            const composed = buildPrompt(prefixModules)
            const composedText =
              slot.role === 'prompt_positive' ? composed.positive : composed.negative
            if (composedText.trim()) {
              slot.prefixText =
                composedText.trim() + (slot.prefixText?.trim() ? `, ${slot.prefixText.trim()}` : '')
            }
          }
        }
      }
    }

    const moduleData = this.resolveModuleData(resolvedConfig.moduleSelections)
    const totalTasks = countTotalTasksFromData(resolvedConfig, moduleData)
    if (totalTasks <= 0) {
      throw new Error('Batch must contain at least one enabled selected item')
    }

    return {
      totalTasks,
      data: {
        name: resolvedConfig.name,
        description: resolvedConfig.description,
        config: JSON.stringify(resolvedConfig),
        workflow_id: resolvedConfig.workflowId,
        total_tasks: totalTasks,
        pipeline_config: resolvedConfig.pipelineConfig
          ? JSON.stringify(resolvedConfig.pipelineConfig)
          : undefined,
        module_data_snapshot: JSON.stringify(moduleData)
      }
    }
  }

  private resolveModuleData(moduleSelections: BatchModuleSelection[]): ModuleDataSnapshot {
    // Keep every selected item when a module supplies more than one dimension.
    const selectedIdsByModule = new Map<string, Set<string>>()
    for (const selection of moduleSelections) {
      let ids = selectedIdsByModule.get(selection.moduleId)
      if (!ids) {
        ids = new Set<string>()
        selectedIdsByModule.set(selection.moduleId, ids)
      }
      for (const id of selection.selectedItemIds) ids.add(id)
    }

    return moduleSelections.map((selection) => ({
      moduleId: selection.moduleId,
      moduleType: selection.moduleType,
      items: this.dependencies.moduleItemRepo
        .list(selection.moduleId)
        .filter((item) => selectedIdsByModule.get(selection.moduleId)!.has(item.id as string))
        .map((item) => ({
          id: item.id as string,
          name: item.name as string,
          prompt: item.prompt as string,
          negative: (item.negative as string) || '',
          weight: (item.weight as number | null) ?? 1.0,
          enabled: (item.enabled as number) !== 0,
          prompt_variants: validatePromptVariants(item.prompt_variants as string)
        }))
    }))
  }
}

export const batchJobService = new BatchJobService({
  batchJobRepo: new BatchJobRepository(),
  moduleRepo: new ModuleRepository(),
  moduleItemRepo: new ModuleItemRepository()
})
