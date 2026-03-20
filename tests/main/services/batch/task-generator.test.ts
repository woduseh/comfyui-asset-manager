import { describe, it, expect } from 'vitest'
import {
  cartesianProduct,
  expandBatchToTasks,
  expandBatchToTasksChunk,
  countTotalTasksFromData,
  calculateTaskCount,
  resolveOutputPath,
  type BatchConfig
} from '../../../../src/main/services/batch/task-generator'

describe('Task Generator', () => {
  describe('cartesianProduct', () => {
    it('returns [[]] for empty input', () => {
      expect(cartesianProduct([])).toEqual([[]])
    })

    it('handles single array', () => {
      const result = cartesianProduct([['a', 'b', 'c']])
      expect(result).toEqual([['a'], ['b'], ['c']])
    })

    it('produces all combinations of two arrays', () => {
      const result = cartesianProduct([
        ['a', 'b'],
        ['1', '2']
      ])
      expect(result).toEqual([
        ['a', '1'],
        ['a', '2'],
        ['b', '1'],
        ['b', '2']
      ])
    })

    it('produces correct count for three arrays', () => {
      const result = cartesianProduct([
        ['a', 'b'],
        ['1', '2', '3'],
        ['x']
      ])
      expect(result).toHaveLength(2 * 3 * 1)
    })

    it('handles array with single element', () => {
      const result = cartesianProduct([['only']])
      expect(result).toEqual([['only']])
    })
  })

  describe('calculateTaskCount', () => {
    it('returns correct count for simple selections', () => {
      const result = calculateTaskCount(
        [
          { moduleId: 'm1', moduleType: 'character', selectedItemIds: ['a', 'b'] },
          { moduleId: 'm2', moduleType: 'emotion', selectedItemIds: ['e1', 'e2', 'e3'] }
        ],
        10
      )
      expect(result.totalCombinations).toBe(6) // 2 × 3
      expect(result.totalTasks).toBe(60) // 6 × 10
    })

    it('returns 0 when no items are selected', () => {
      const result = calculateTaskCount(
        [{ moduleId: 'm1', moduleType: 'character', selectedItemIds: [] }],
        10
      )
      expect(result.totalCombinations).toBe(0)
      expect(result.totalTasks).toBe(0)
    })

    it('handles single dimension', () => {
      const result = calculateTaskCount(
        [{ moduleId: 'm1', moduleType: 'character', selectedItemIds: ['a', 'b', 'c'] }],
        5
      )
      expect(result.totalCombinations).toBe(3)
      expect(result.totalTasks).toBe(15)
    })

    it('ignores empty selections', () => {
      const result = calculateTaskCount(
        [
          { moduleId: 'm1', moduleType: 'character', selectedItemIds: ['a'] },
          { moduleId: 'm2', moduleType: 'emotion', selectedItemIds: [] },
          { moduleId: 'm3', moduleType: 'outfit', selectedItemIds: ['o1', 'o2'] }
        ],
        1
      )
      // Empty selections are skipped entirely, so 1 × 2 = 2
      expect(result.totalCombinations).toBe(2)
      expect(result.totalTasks).toBe(2)
    })
  })

  describe('resolveOutputPath', () => {
    it('replaces variable placeholders', () => {
      const result = resolveOutputPath('{job}/{character}/{emotion}', {
        job: 'batch1',
        character: 'Alice',
        emotion: 'happy'
      })
      expect(result).toBe('batch1/Alice/happy')
    })

    it('sanitizes special characters in values', () => {
      const result = resolveOutputPath('{name}', { name: 'test<>:"/\\|?*file' })
      expect(result).toBe('test_________file')
    })

    it('leaves unmatched placeholders unchanged', () => {
      const result = resolveOutputPath('{character}/{unknown}', { character: 'Alice' })
      expect(result).toBe('Alice/{unknown}')
    })

    it('handles empty vars', () => {
      const result = resolveOutputPath('static/path', {})
      expect(result).toBe('static/path')
    })

    it('replaces multiple occurrences of same variable', () => {
      const result = resolveOutputPath('{name}_{name}', { name: 'test' })
      expect(result).toBe('test_test')
    })
  })

  describe('expandBatchToTasks', () => {
    const makeConfig = (overrides?: Partial<BatchConfig>): BatchConfig => ({
      name: 'Test Batch',
      workflowId: 'wf-1',
      moduleSelections: [
        { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] },
        { moduleId: 'mod-emo', moduleType: 'emotion', selectedItemIds: ['emo-1', 'emo-2'] }
      ],
      countPerCombination: 2,
      seedMode: 'fixed',
      fixedSeed: 42,
      outputFolderPattern: '{character}/{emotion}',
      fileNamePattern: '{character}_{emotion}_{index}',
      ...overrides
    })

    const moduleData = [
      {
        moduleId: 'mod-char',
        moduleType: 'character',
        items: [
          {
            id: 'char-1',
            name: 'Alice',
            prompt: '1girl, alice',
            negative: 'bad anatomy',
            weight: 1.0,
            enabled: true
          }
        ]
      },
      {
        moduleId: 'mod-emo',
        moduleType: 'emotion',
        items: [
          {
            id: 'emo-1',
            name: 'Happy',
            prompt: 'happy, smile',
            negative: '',
            weight: 1.0,
            enabled: true
          },
          {
            id: 'emo-2',
            name: 'Sad',
            prompt: 'sad, tears',
            negative: '',
            weight: 1.0,
            enabled: true
          }
        ]
      }
    ]

    it('generates correct number of tasks', () => {
      const config = makeConfig()
      const tasks = expandBatchToTasks(config, moduleData)
      // 1 character × 2 emotions × 2 per combo = 4
      expect(tasks).toHaveLength(4)
    })

    it('assigns correct sort orders', () => {
      const config = makeConfig()
      const tasks = expandBatchToTasks(config, moduleData)
      expect(tasks.map((t) => t.sortOrder)).toEqual([0, 1, 2, 3])
    })

    it('extracts metadata correctly', () => {
      const config = makeConfig()
      const tasks = expandBatchToTasks(config, moduleData)
      expect(tasks[0].metadata.characterName).toBe('Alice')
      expect(tasks[0].metadata.emotionName).toBe('Happy')
      expect(tasks[2].metadata.emotionName).toBe('Sad')
    })

    it('uses fixed seed mode', () => {
      const config = makeConfig({ seedMode: 'fixed', fixedSeed: 100 })
      const tasks = expandBatchToTasks(config, moduleData)
      expect(tasks[0].promptData.seed).toBe(100)
      expect(tasks[1].promptData.seed).toBe(100)
    })

    it('uses incremental seed mode', () => {
      const config = makeConfig({ seedMode: 'incremental', fixedSeed: 100 })
      const tasks = expandBatchToTasks(config, moduleData)
      expect(tasks[0].promptData.seed).toBe(100)
      expect(tasks[1].promptData.seed).toBe(101)
      expect(tasks[2].promptData.seed).toBe(102)
    })

    it('generates prompts from character before emotion', () => {
      const config = makeConfig()
      const tasks = expandBatchToTasks(config, moduleData)
      // character comes before emotion in type order
      expect(tasks[0].promptData.positive).toContain('1girl, alice')
      expect(tasks[0].promptData.positive).toContain('happy, smile')
    })

    it('returns empty array when no module data matches', () => {
      const config = makeConfig({
        moduleSelections: [
          { moduleId: 'nonexistent', moduleType: 'character', selectedItemIds: ['x'] }
        ]
      })
      const tasks = expandBatchToTasks(config, moduleData)
      expect(tasks).toEqual([])
    })

    it('filters out disabled items', () => {
      const disabledModuleData = [
        {
          moduleId: 'mod-char',
          moduleType: 'character',
          items: [
            {
              id: 'char-1',
              name: 'Alice',
              prompt: '1girl',
              negative: '',
              weight: 1.0,
              enabled: false
            }
          ]
        }
      ]
      const config = makeConfig({
        moduleSelections: [
          { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] }
        ]
      })
      const tasks = expandBatchToTasks(config, disabledModuleData)
      expect(tasks).toEqual([])
    })

    it('sets combinationIndex and imageIndex correctly', () => {
      const config = makeConfig({ countPerCombination: 3 })
      const tasks = expandBatchToTasks(config, moduleData)
      // combo 0 (Alice + Happy): images 0, 1, 2
      expect(tasks[0].metadata.combinationIndex).toBe(0)
      expect(tasks[0].metadata.imageIndex).toBe(0)
      expect(tasks[1].metadata.imageIndex).toBe(1)
      expect(tasks[2].metadata.imageIndex).toBe(2)
      // combo 1 (Alice + Sad): images 0, 1, 2
      expect(tasks[3].metadata.combinationIndex).toBe(1)
      expect(tasks[3].metadata.imageIndex).toBe(0)
    })

    describe('prompt variants', () => {
      const variantModuleData = [
        {
          moduleId: 'mod-char',
          moduleType: 'character',
          items: [
            {
              id: 'char-1',
              name: 'Alice',
              prompt: '1girl, alice, blonde hair',
              negative: 'bad anatomy',
              weight: 1.0,
              enabled: true,
              prompt_variants: {
                '자연어': { prompt: 'A cute girl named Alice with blonde hair', negative: 'ugly' },
                '태그': { prompt: '1girl, alice, blonde_hair, blue_dress', negative: 'bad_anatomy' }
              }
            }
          ]
        }
      ]

      it('uses default prompt when no promptVariant is specified', () => {
        const config = makeConfig({
          moduleSelections: [
            { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] }
          ],
          countPerCombination: 1,
          slotMappings: [{
            variableId: 'v1', nodeId: 'n1', fieldName: 'text',
            role: 'prompt_positive', action: 'inject', fixedValue: '',
            assignedModuleIds: ['mod-char'], prefixModuleIds: [],
            prefixText: '', suffixText: ''
          }]
        })
        const tasks = expandBatchToTasks(config, variantModuleData)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].promptData.slotPrompts!['n1:text']).toContain('1girl, alice, blonde hair')
      })

      it('uses variant prompt when promptVariant is specified', () => {
        const config = makeConfig({
          moduleSelections: [
            { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] }
          ],
          countPerCombination: 1,
          slotMappings: [{
            variableId: 'v1', nodeId: 'n1', fieldName: 'text',
            role: 'prompt_positive', action: 'inject', fixedValue: '',
            assignedModuleIds: ['mod-char'], prefixModuleIds: [],
            prefixText: '', suffixText: '', promptVariant: '태그'
          }]
        })
        const tasks = expandBatchToTasks(config, variantModuleData)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].promptData.slotPrompts!['n1:text']).toContain('1girl, alice, blonde_hair, blue_dress')
        expect(tasks[0].promptData.slotPrompts!['n1:text']).not.toContain('blonde hair')
      })

      it('falls back to default when variant name does not exist', () => {
        const config = makeConfig({
          moduleSelections: [
            { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] }
          ],
          countPerCombination: 1,
          slotMappings: [{
            variableId: 'v1', nodeId: 'n1', fieldName: 'text',
            role: 'prompt_positive', action: 'inject', fixedValue: '',
            assignedModuleIds: ['mod-char'], prefixModuleIds: [],
            prefixText: '', suffixText: '', promptVariant: 'nonexistent'
          }]
        })
        const tasks = expandBatchToTasks(config, variantModuleData)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].promptData.slotPrompts!['n1:text']).toContain('1girl, alice, blonde hair')
      })

      it('uses variant negative prompt for negative slots', () => {
        const config = makeConfig({
          moduleSelections: [
            { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] }
          ],
          countPerCombination: 1,
          slotMappings: [{
            variableId: 'v2', nodeId: 'n2', fieldName: 'text',
            role: 'prompt_negative', action: 'inject', fixedValue: '',
            assignedModuleIds: ['mod-char'], prefixModuleIds: [],
            prefixText: '', suffixText: '', promptVariant: '태그'
          }]
        })
        const tasks = expandBatchToTasks(config, variantModuleData)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].promptData.slotPrompts!['n2:text']).toContain('bad_anatomy')
      })

      it('supports different variants per slot', () => {
        const config = makeConfig({
          moduleSelections: [
            { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['char-1'] }
          ],
          countPerCombination: 1,
          slotMappings: [
            {
              variableId: 'v1', nodeId: 'n1', fieldName: 'text',
              role: 'prompt_positive', action: 'inject', fixedValue: '',
              assignedModuleIds: ['mod-char'], prefixModuleIds: [],
              prefixText: '', suffixText: '', promptVariant: '자연어'
            },
            {
              variableId: 'v2', nodeId: 'n2', fieldName: 'text',
              role: 'prompt_positive', action: 'inject', fixedValue: '',
              assignedModuleIds: ['mod-char'], prefixModuleIds: [],
              prefixText: '', suffixText: '', promptVariant: '태그'
            }
          ]
        })
        const tasks = expandBatchToTasks(config, variantModuleData)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].promptData.slotPrompts!['n1:text']).toContain('A cute girl named Alice')
        expect(tasks[0].promptData.slotPrompts!['n2:text']).toContain('1girl, alice, blonde_hair')
      })

      it('works with items that have no prompt_variants field', () => {
        const config = makeConfig({
          countPerCombination: 1,
          slotMappings: [{
            variableId: 'v1', nodeId: 'n1', fieldName: 'text',
            role: 'prompt_positive', action: 'inject', fixedValue: '',
            assignedModuleIds: ['mod-char', 'mod-emo'], prefixModuleIds: [],
            prefixText: '', suffixText: '', promptVariant: '태그'
          }]
        })
        // moduleData has no prompt_variants on its items — should fall back gracefully
        const tasks = expandBatchToTasks(config, moduleData)
        expect(tasks).toHaveLength(2)
        expect(tasks[0].promptData.slotPrompts!['n1:text']).toContain('1girl, alice')
      })
    })
  })

  describe('expandBatchToTasksChunk', () => {
    const makeChunkConfig = (overrides?: Partial<BatchConfig>): BatchConfig => ({
      name: 'Test Batch',
      workflowId: 'wf-1',
      moduleSelections: [
        { moduleId: 'mod-char', moduleType: 'character', selectedItemIds: ['c1', 'c2'] },
        { moduleId: 'mod-emo', moduleType: 'emotion', selectedItemIds: ['e1', 'e2', 'e3'] }
      ],
      countPerCombination: 2,
      seedMode: 'incremental',
      fixedSeed: 100,
      outputFolderPattern: '{character}/{emotion}',
      fileNamePattern: '{character}_{emotion}_{index}',
      ...overrides
    })

    const moduleData = [
      {
        moduleId: 'mod-char',
        moduleType: 'character',
        items: [
          { id: 'c1', name: 'Alice', prompt: '1girl, alice', negative: '', weight: 1.0, enabled: true },
          { id: 'c2', name: 'Bob', prompt: '1boy, bob', negative: '', weight: 1.0, enabled: true }
        ]
      },
      {
        moduleId: 'mod-emo',
        moduleType: 'emotion',
        items: [
          { id: 'e1', name: 'Happy', prompt: 'smile', negative: '', weight: 1.0, enabled: true },
          { id: 'e2', name: 'Sad', prompt: 'crying', negative: '', weight: 1.0, enabled: true },
          { id: 'e3', name: 'Angry', prompt: 'angry', negative: '', weight: 1.0, enabled: true }
        ]
      }
    ]

    const config = makeChunkConfig()

    it('countTotalTasksFromData returns correct count', () => {
      const count = countTotalTasksFromData(config, moduleData)
      // 2 chars × 3 emotions × 2 per combo = 12
      expect(count).toBe(12)
    })

    it('generates correct chunk at start', () => {
      const tasks = expandBatchToTasksChunk(config, moduleData, 0, 4)
      expect(tasks).toHaveLength(4)
      expect(tasks[0].sortOrder).toBe(0)
      expect(tasks[3].sortOrder).toBe(3)
      // First combo (char=Alice, emo=Happy), image 0 and 1
      expect(tasks[0].metadata.characterName).toBe('Alice')
      expect(tasks[0].metadata.emotionName).toBe('Happy')
      expect(tasks[0].metadata.imageIndex).toBe(0)
      expect(tasks[1].metadata.imageIndex).toBe(1)
      // Second combo (char=Alice, emo=Sad)
      expect(tasks[2].metadata.emotionName).toBe('Sad')
    })

    it('generates correct chunk in the middle', () => {
      const tasks = expandBatchToTasksChunk(config, moduleData, 4, 4)
      expect(tasks).toHaveLength(4)
      expect(tasks[0].sortOrder).toBe(4)
      // Should be combo 2 (Alice, Angry), image 0
      expect(tasks[0].metadata.characterName).toBe('Alice')
      expect(tasks[0].metadata.emotionName).toBe('Angry')
      expect(tasks[0].metadata.imageIndex).toBe(0)
    })

    it('generates correct chunk at the end (partial)', () => {
      const tasks = expandBatchToTasksChunk(config, moduleData, 10, 50)
      // Only 2 remaining (index 10, 11)
      expect(tasks).toHaveLength(2)
      expect(tasks[0].sortOrder).toBe(10)
      expect(tasks[1].sortOrder).toBe(11)
    })

    it('returns empty for out-of-range start', () => {
      const tasks = expandBatchToTasksChunk(config, moduleData, 100, 10)
      expect(tasks).toHaveLength(0)
    })

    it('uses incremental seeds based on sortOrder', () => {
      const tasks = expandBatchToTasksChunk(config, moduleData, 0, 4)
      expect(tasks[0].promptData.seed).toBe(100) // fixedSeed + 0
      expect(tasks[1].promptData.seed).toBe(101) // fixedSeed + 1
      expect(tasks[2].promptData.seed).toBe(102)
      expect(tasks[3].promptData.seed).toBe(103)
    })

    it('matches full expansion results', () => {
      // Verify chunk generation matches full expandBatchToTasks
      const fullTasks = expandBatchToTasks(config, moduleData)
      const chunk1 = expandBatchToTasksChunk(config, moduleData, 0, 6)
      const chunk2 = expandBatchToTasksChunk(config, moduleData, 6, 6)
      const allChunked = [...chunk1, ...chunk2]

      expect(allChunked).toHaveLength(fullTasks.length)
      for (let i = 0; i < fullTasks.length; i++) {
        expect(allChunked[i].metadata).toEqual(fullTasks[i].metadata)
        expect(allChunked[i].sortOrder).toBe(fullTasks[i].sortOrder)
        expect(allChunked[i].promptData.seed).toBe(fullTasks[i].promptData.seed)
        expect(allChunked[i].promptData.positive).toBe(fullTasks[i].promptData.positive)
      }
    })
  })
})
