import { describe, it, expect } from 'vitest'
import {
  validateString,
  validateId,
  validatePositiveInt,
  validateRating,
  validateSettingsKey,
  validateStringArray,
  validatePromptVariants,
  validateGalleryQuery,
  validateAbsolutePath,
  validateBatchConfig,
  validateBatchPreviewInput,
  validateBoolean,
  validateCharacterData,
  validateIntegerRange,
  validateModuleData,
  validateModuleItemData,
  validateTerminalDimensions,
  validateTerminalInput,
  validateWorkflowRole,
  validateWorkflowUpdate,
  validateWorkflowVariables
} from '../../../src/main/ipc/validators'
import { resolve } from 'path'

describe('validateString', () => {
  it('returns valid string', () => {
    expect(validateString('hello')).toBe('hello')
  })

  it('returns empty string', () => {
    expect(validateString('')).toBe('')
  })

  it('throws on non-string', () => {
    expect(() => validateString(123)).toThrow('Expected string')
    expect(() => validateString(null)).toThrow('Expected string')
    expect(() => validateString(undefined)).toThrow('Expected string')
    expect(() => validateString({})).toThrow('Expected string')
  })

  it('throws when string exceeds max length', () => {
    expect(() => validateString('abc', 2)).toThrow('max length')
  })

  it('respects custom max length', () => {
    expect(validateString('ab', 2)).toBe('ab')
  })
})

describe('validateId', () => {
  it('accepts valid IDs', () => {
    expect(validateId('abc-123')).toBe('abc-123')
    expect(validateId('my_module_01')).toBe('my_module_01')
    expect(validateId('UUID-like-value')).toBe('UUID-like-value')
  })

  it('rejects IDs with special characters', () => {
    expect(() => validateId('a b')).toThrow('Invalid ID')
    expect(() => validateId('a/b')).toThrow('Invalid ID')
    expect(() => validateId('../etc')).toThrow('Invalid ID')
    expect(() => validateId('a;DROP')).toThrow('Invalid ID')
  })

  it('rejects non-string input', () => {
    expect(() => validateId(42)).toThrow('Expected string')
  })

  it('rejects overly long IDs', () => {
    expect(() => validateId('a'.repeat(101))).toThrow('max length')
  })
})

describe('validatePositiveInt', () => {
  it('accepts zero', () => {
    expect(validatePositiveInt(0)).toBe(0)
  })

  it('accepts positive integers', () => {
    expect(validatePositiveInt(42)).toBe(42)
    expect(validatePositiveInt(1000)).toBe(1000)
  })

  it('rejects negative numbers', () => {
    expect(() => validatePositiveInt(-1)).toThrow('non-negative integer')
  })

  it('rejects floats', () => {
    expect(() => validatePositiveInt(1.5)).toThrow('non-negative integer')
  })

  it('rejects non-numbers', () => {
    expect(() => validatePositiveInt('5')).toThrow('non-negative integer')
    expect(() => validatePositiveInt(null)).toThrow('non-negative integer')
  })
})

describe('validateRating', () => {
  it('accepts valid ratings 0-5', () => {
    expect(validateRating(0)).toBe(0)
    expect(validateRating(3)).toBe(3)
    expect(validateRating(5)).toBe(5)
    expect(validateRating(2.5)).toBe(2.5)
  })

  it('rejects out-of-range ratings', () => {
    expect(() => validateRating(-1)).toThrow('between 0 and 5')
    expect(() => validateRating(6)).toThrow('between 0 and 5')
    expect(() => validateRating(Number.NaN)).toThrow('between 0 and 5')
  })

  it('rejects non-numbers', () => {
    expect(() => validateRating('3')).toThrow('between 0 and 5')
  })
})

describe('validateSettingsKey', () => {
  it('accepts known settings keys', () => {
    expect(validateSettingsKey('comfyui_host')).toBe('comfyui_host')
    expect(validateSettingsKey('language')).toBe('language')
    expect(validateSettingsKey('mcp_port')).toBe('mcp_port')
    expect(validateSettingsKey('mcp_auth_required')).toBe('mcp_auth_required')
    expect(validateSettingsKey('output.directory')).toBe('output.directory')
  })

  it('rejects unknown keys', () => {
    expect(() => validateSettingsKey('admin_password')).toThrow('Unknown settings key')
    expect(() => validateSettingsKey('__proto__')).toThrow('Unknown settings key')
  })

  it('rejects non-string input', () => {
    expect(() => validateSettingsKey(42)).toThrow('Expected string')
  })
})

describe('validateStringArray', () => {
  it('accepts array of valid IDs', () => {
    expect(validateStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array', () => {
    expect(validateStringArray([])).toEqual([])
  })

  it('rejects non-array', () => {
    expect(() => validateStringArray('not-array')).toThrow('Expected array')
    expect(() => validateStringArray(null)).toThrow('Expected array')
  })

  it('rejects oversized arrays', () => {
    const big = new Array(5).fill('a')
    expect(() => validateStringArray(big, 3)).toThrow('max length')
  })

  it('validates each element as ID', () => {
    expect(() => validateStringArray(['valid', 'has space'])).toThrow('Invalid ID')
  })
})

describe('validatePromptVariants', () => {
  it('returns empty object for empty string', () => {
    expect(validatePromptVariants('')).toEqual({})
  })

  it('returns empty object for "{}"', () => {
    expect(validatePromptVariants('{}')).toEqual({})
  })

  it('returns empty object for null/undefined', () => {
    expect(validatePromptVariants(null)).toEqual({})
    expect(validatePromptVariants(undefined)).toEqual({})
  })

  it('parses valid prompt variants', () => {
    const json = JSON.stringify({
      natural: { prompt: 'a beautiful scene', negative: 'ugly' },
      tags: { prompt: '1girl, blue_hair', negative: 'lowres' }
    })
    const result = validatePromptVariants(json)
    expect(result).toEqual({
      natural: { prompt: 'a beautiful scene', negative: 'ugly' },
      tags: { prompt: '1girl, blue_hair', negative: 'lowres' }
    })
  })

  it('filters out malformed entries', () => {
    const json = JSON.stringify({
      valid: { prompt: 'good', negative: 'bad' },
      missing_negative: { prompt: 'only prompt' },
      wrong_type: { prompt: 123, negative: 'ok' },
      not_object: 'string'
    })
    const result = validatePromptVariants(json)
    expect(result).toEqual({
      valid: { prompt: 'good', negative: 'bad' }
    })
  })

  it('rejects arrays', () => {
    const json = JSON.stringify([{ prompt: 'a', negative: 'b' }])
    expect(validatePromptVariants(json)).toEqual({})
  })

  it('returns empty for invalid JSON', () => {
    expect(validatePromptVariants('not-json{')).toEqual({})
  })
})

describe('validateGalleryQuery', () => {
  it('accepts a valid gallery query', () => {
    expect(
      validateGalleryQuery({
        page: 1,
        pageSize: 50,
        searchText: 'alice',
        minRating: 3,
        isFavorite: true,
        sortBy: 'rating',
        sortOrder: 'desc'
      })
    ).toEqual({
      page: 1,
      pageSize: 50,
      searchText: 'alice',
      minRating: 3,
      isFavorite: true,
      sortBy: 'rating',
      sortOrder: 'desc'
    })
  })

  it('rejects invalid sort fields', () => {
    expect(() =>
      validateGalleryQuery({
        page: 1,
        pageSize: 50,
        sortBy: 'created_at; DROP TABLE generated_images --'
      })
    ).toThrow('Invalid gallery sort field')
  })

  it('rejects invalid sort order', () => {
    expect(() =>
      validateGalleryQuery({
        page: 1,
        pageSize: 50,
        sortOrder: 'descending'
      })
    ).toThrow('Invalid gallery sort order')
  })

  it('rejects non-positive pagination values', () => {
    expect(() => validateGalleryQuery({ page: 0, pageSize: 50 })).toThrow(
      'Gallery page must be a positive integer'
    )
    expect(() => validateGalleryQuery({ page: 1, pageSize: 0 })).toThrow(
      'Gallery page size must be a positive integer'
    )
    expect(() => validateGalleryQuery({ page: 1, pageSize: 501 })).toThrow('maximum value')
  })
})

describe('validateAbsolutePath', () => {
  it('accepts an absolute path', () => {
    const filePath = resolve('tmp', 'workflow.json')
    expect(validateAbsolutePath(filePath)).toBe(filePath)
  })

  it('rejects a relative path', () => {
    expect(() => validateAbsolutePath('workflow.json')).toThrow('Expected absolute path')
  })

  it('rejects disallowed extensions', () => {
    const filePath = resolve('tmp', 'workflow.txt')
    expect(() => validateAbsolutePath(filePath, ['.json'])).toThrow('Invalid file extension')
  })
})

describe('bounded primitive validators', () => {
  it('rejects unsafe integers and out-of-range values', () => {
    expect(() => validatePositiveInt(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(validateIntegerRange(5, 1, 10)).toBe(5)
    expect(() => validateIntegerRange(11, 1, 10, 'Count')).toThrow('Count')
  })

  it('requires actual booleans', () => {
    expect(validateBoolean(false)).toBe(false)
    expect(() => validateBoolean('false')).toThrow('Expected boolean')
  })
})

describe('entity mutation validators', () => {
  it('accepts known module fields and rejects unknown fields or module types', () => {
    expect(() =>
      validateModuleData({ name: 'Characters', type: 'character', description: '' })
    ).not.toThrow()
    expect(() => validateModuleData({ name: 'Bad', type: 'unknown' })).toThrow('module type')
    expect(() => validateModuleData({ name: 'Bad', type: 'custom', injected: true })).toThrow(
      'Unknown module'
    )
  })

  it('validates workflow updates and roles', () => {
    expect(() => validateWorkflowUpdate({ name: 'Workflow', category: 'generation' })).not.toThrow()
    expect(() => validateWorkflowUpdate({ category: 'invalid' })).toThrow('workflow category')
    expect(validateWorkflowRole('prompt_positive')).toBe('prompt_positive')
    expect(() => validateWorkflowRole('administrator')).toThrow('workflow role')
  })

  it('validates module item prompt variants strictly', () => {
    expect(() =>
      validateModuleItemData({
        module_id: 'module-id',
        name: 'Alice',
        prompt: '1girl',
        prompt_variants: { natural: { prompt: 'portrait', negative: '' } }
      })
    ).not.toThrow()
    expect(() =>
      validateModuleItemData({
        module_id: 'module-id',
        name: 'Alice',
        prompt: '1girl',
        prompt_variants: '{'
      })
    ).toThrow('prompt variants JSON')
  })

  it('validates character fields and workflow variable arrays', () => {
    expect(() => validateCharacterData({ name: 'Alice', base_prompt: '1girl' })).not.toThrow()
    expect(() =>
      validateCharacterData({ name: 'Alice', base_prompt: '1girl', extra: true })
    ).toThrow('Unknown character')
    expect(() =>
      validateWorkflowVariables([
        {
          node_id: '1',
          field_name: 'text',
          display_name: 'Prompt',
          var_type: 'text',
          role: 'prompt_positive'
        }
      ])
    ).not.toThrow()
    expect(() =>
      validateWorkflowVariables([
        {
          node_id: '1',
          field_name: 'text',
          display_name: 'Prompt',
          var_type: 'text',
          role: 'root'
        }
      ])
    ).toThrow('workflow role')
  })
})

function makeBatchConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    countPerCombination: 1,
    seedMode: 'random',
    outputFolderPattern: '{job}',
    fileNamePattern: '{index}',
    ...overrides
  }
}

describe('validateBatchConfig', () => {
  it('accepts a complete bounded batch config', () => {
    expect(() =>
      validateBatchConfig(
        makeBatchConfig({
          slotMappings: [
            {
              variableId: 'variable-id',
              nodeId: '1',
              fieldName: 'text',
              role: 'prompt_positive',
              action: 'inject',
              fixedValue: '',
              assignedModuleIds: ['module-id'],
              prefixModuleIds: [],
              prefixText: '',
              suffixText: ''
            }
          ],
          variableOverrides: [{ nodeId: '1', fieldName: 'seed', value: '42' }]
        })
      )
    ).not.toThrow()
  })

  it('rejects malformed seed modes, counts, and nested fields', () => {
    expect(() => validateBatchConfig(makeBatchConfig({ seedMode: 'repeat' }))).toThrow('seed mode')
    expect(() => validateBatchConfig(makeBatchConfig({ countPerCombination: 0 }))).toThrow(
      'count per combination'
    )
    expect(() =>
      validateBatchConfig(
        makeBatchConfig({
          moduleSelections: [
            {
              moduleId: 'module-id',
              moduleType: 'character',
              selectedItemIds: ['item-id'],
              injected: true
            }
          ]
        })
      )
    ).toThrow('Unknown module selection')
  })

  it('rejects batch configurations above the task safety ceiling', () => {
    expect(() =>
      validateBatchConfig(
        makeBatchConfig({
          moduleSelections: Array.from({ length: 3 }, (_, index) => ({
            moduleId: `module-${index}`,
            moduleType: 'custom',
            selectedItemIds: Array.from({ length: 101 }, (_, item) => `item-${item}`)
          }))
        })
      )
    ).toThrow('maximum task count')
  })

  it('rejects output folder patterns that can escape the configured root', () => {
    expect(() =>
      validateBatchConfig(makeBatchConfig({ outputFolderPattern: '../outside' }))
    ).toThrow(/output folder pattern/i)
    expect(() =>
      validateBatchConfig(makeBatchConfig({ outputFolderPattern: 'nested/../../outside' }))
    ).toThrow(/output folder pattern/i)
    expect(() =>
      validateBatchConfig(makeBatchConfig({ outputFolderPattern: 'C:/outside' }))
    ).toThrow(/output folder pattern/i)
    expect(() => validateBatchConfig(makeBatchConfig({ outputFolderPattern: '/outside' }))).toThrow(
      /output folder pattern/i
    )
  })

  it('rejects file name patterns that contain path components', () => {
    expect(() => validateBatchConfig(makeBatchConfig({ fileNamePattern: '../image' }))).toThrow(
      /filename pattern/i
    )
    expect(() => validateBatchConfig(makeBatchConfig({ fileNamePattern: 'nested/image' }))).toThrow(
      /filename pattern/i
    )
    expect(() =>
      validateBatchConfig(makeBatchConfig({ fileNamePattern: 'nested\\image' }))
    ).toThrow(/filename pattern/i)
  })

  it('uses the same bounds for preview inputs', () => {
    const config = makeBatchConfig()
    expect(() =>
      validateBatchPreviewInput(config.moduleSelections, config.countPerCombination)
    ).not.toThrow()
    expect(() => validateBatchPreviewInput([], 10_001)).toThrow('count per combination')
  })
})

describe('terminal validators', () => {
  it('bounds terminal dimensions and input', () => {
    expect(() => validateTerminalDimensions(120, 40)).not.toThrow()
    expect(() => validateTerminalDimensions(0, 40)).toThrow('Terminal columns')
    expect(() => validateTerminalDimensions(120, 1001)).toThrow('Terminal rows')
    expect(() => validateTerminalInput('terminal-id', 'pwd\r')).not.toThrow()
    expect(() => validateTerminalInput('../terminal', 'pwd\r')).toThrow('Invalid ID')
  })
})
