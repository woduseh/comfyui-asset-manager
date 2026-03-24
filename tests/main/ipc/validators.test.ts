import { describe, it, expect } from 'vitest'
import {
  validateString,
  validateId,
  validatePositiveInt,
  validateRating,
  validateSettingsKey,
  validateStringArray,
  validatePromptVariants,
  validateGalleryQuery
} from '../../../src/main/ipc/validators'

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
  })
})
