import { describe, it, expect } from 'vitest'
import {
  cartesianProduct,
  expandBatchToTasks,
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
  })
})
