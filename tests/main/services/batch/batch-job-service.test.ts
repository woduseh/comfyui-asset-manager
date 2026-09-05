import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BatchJobService,
  type PreparedBatchJob
} from '../../../../src/main/services/batch/batch-job-service'
import type { BatchConfig } from '@shared/ipc-contract'
import { expandBatchToTasksChunk } from '../../../../src/main/services/batch/task-generator'

function makeConfig(overrides: Partial<BatchConfig> = {}): BatchConfig {
  return {
    name: 'Batch',
    workflowId: 'workflow-id',
    moduleSelections: [
      {
        moduleId: 'module-id',
        moduleType: 'character',
        selectedItemIds: ['item-id']
      }
    ],
    countPerCombination: 2,
    seedMode: 'random',
    outputFolderPattern: '{job}',
    fileNamePattern: '{index}',
    ...overrides
  }
}

describe('BatchJobService', () => {
  const create = vi.fn<(_data: PreparedBatchJob['data']) => string>(() => 'job-id')
  const updateDraft = vi.fn()
  const moduleGet = vi.fn(() => ({ id: 'module-id', type: 'character' }))
  const moduleItemList = vi.fn(() => [
    {
      id: 'item-id',
      name: 'Item',
      prompt: 'base prompt',
      negative: 'base negative',
      weight: 1,
      enabled: 1,
      prompt_variants: JSON.stringify({ tags: { prompt: 'tag prompt', negative: 'tag negative' } })
    }
  ])
  const service = new BatchJobService({
    batchJobRepo: { create, updateDraft },
    moduleRepo: { get: moduleGet },
    moduleItemRepo: { list: moduleItemList }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a lazy job with a module snapshot and no eager task rows', () => {
    const result = service.create(makeConfig())

    expect(result).toEqual({ jobId: 'job-id', totalTasks: 2 })
    expect(create).toHaveBeenCalledOnce()
    const data = create.mock.calls[0][0]
    expect(data.total_tasks).toBe(2)
    expect(JSON.parse(data.module_data_snapshot as string)).toEqual([
      expect.objectContaining({
        moduleId: 'module-id',
        items: [expect.objectContaining({ id: 'item-id', prompt: 'base prompt' })]
      })
    ])
  })

  it('resolves slot prefix modules in the persisted config', () => {
    const prepared: PreparedBatchJob = service.prepare(
      makeConfig({
        slotMappings: [
          {
            variableId: 'variable-id',
            nodeId: '1',
            fieldName: 'text',
            role: 'prompt_positive',
            action: 'inject',
            fixedValue: '',
            assignedModuleIds: ['module-id'],
            prefixModuleIds: ['module-id'],
            prefixText: 'manual prefix',
            suffixText: '',
            promptVariant: 'tags'
          }
        ]
      })
    )

    const persistedConfig = JSON.parse(prepared.data.config)
    expect(persistedConfig.slotMappings[0]).toEqual(
      expect.objectContaining({
        userPrefixText: 'manual prefix',
        prefixText: 'tag prompt, manual prefix'
      })
    )
  })

  it('omits unselected snapshot items while preserving their resolved prefix contribution', () => {
    const items = moduleItemList()
    items.push({ ...items[0], id: 'unselected', prompt: 'prefix only', prompt_variants: '{}' })
    moduleItemList.mockReturnValueOnce(items).mockReturnValueOnce(items)
    const prepared = service.prepare(
      makeConfig({
        slotMappings: [
          {
            variableId: 'variable-id',
            nodeId: '1',
            fieldName: 'text',
            role: 'prompt_positive',
            action: 'inject',
            fixedValue: '',
            assignedModuleIds: ['module-id'],
            prefixModuleIds: ['module-id'],
            prefixText: '',
            suffixText: ''
          }
        ]
      })
    )
    const snapshot = JSON.parse(prepared.data.module_data_snapshot!)
    const config = JSON.parse(prepared.data.config)

    expect(snapshot[0].items.map((item: { id: string }) => item.id)).toEqual(['item-id'])
    expect(config.slotMappings[0].prefixText).toBe('base prompt, prefix only')
    const tasks = expandBatchToTasksChunk(config, snapshot, 0, 10)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].promptData.positive).toBe('base prompt')
    expect(tasks[0].promptData.slotPrompts!['1:text']).toBe('base prompt, prefix only, base prompt')
  })

  it('retains selections from repeated module dimensions in compact snapshots', () => {
    const items = moduleItemList()
    items.push({ ...items[0], id: 'second', name: 'Second', prompt: 'second prompt' })
    items.push({ ...items[0], id: 'unselected' })
    moduleItemList.mockReturnValueOnce(items).mockReturnValueOnce(items)
    const prepared = service.prepare(
      makeConfig({
        moduleSelections: [
          { moduleId: 'module-id', moduleType: 'character', selectedItemIds: ['item-id'] },
          { moduleId: 'module-id', moduleType: 'emotion', selectedItemIds: ['second'] }
        ]
      })
    )
    const snapshot = JSON.parse(prepared.data.module_data_snapshot!)
    expect(snapshot[0].items.map((item: { id: string }) => item.id)).toEqual(['item-id', 'second'])
    const tasks = expandBatchToTasksChunk(JSON.parse(prepared.data.config), snapshot, 0, 10)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].metadata).toMatchObject({ characterName: 'Item', emotionName: 'Second' })
    expect(tasks[0].promptData.positive).toBe('base prompt, second prompt')
  })

  it('updates an existing draft through the same preparation path', () => {
    const result = service.updateDraft('existing-job', makeConfig())

    expect(result).toEqual({ jobId: 'existing-job', totalTasks: 2 })
    expect(updateDraft).toHaveBeenCalledWith(
      'existing-job',
      expect.objectContaining({ total_tasks: 2 })
    )
  })

  it('rejects invalid or empty jobs before persistence', () => {
    expect(() => service.create(makeConfig({ countPerCombination: 0 }))).toThrow(
      'count per combination'
    )

    moduleItemList.mockReturnValueOnce([])
    expect(() => service.create(makeConfig())).toThrow('at least one enabled selected item')
    expect(create).not.toHaveBeenCalled()
  })
})
