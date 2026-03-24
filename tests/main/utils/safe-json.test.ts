import { describe, expect, it } from 'vitest'
import { isJsonObject, safeJsonParse } from '../../../src/main/utils/safe-json'

describe('safeJsonParse', () => {
  it('returns a parsed value when JSON is valid and passes validation', () => {
    const result = safeJsonParse<Record<string, unknown>>('{"name":"Alice"}', {
      context: 'Test payload',
      validate: isJsonObject,
      invalidShapeMessage: 'Test payload must be an object'
    })

    expect(result).toEqual({
      ok: true,
      value: { name: 'Alice' }
    })
  })

  it('returns an error when JSON is invalid', () => {
    const result = safeJsonParse('{', { context: 'Test payload' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Test payload')
      expect(result.error).toContain('valid JSON')
    }
  })

  it('returns an error when validation fails', () => {
    const result = safeJsonParse<Record<string, unknown>>('[]', {
      context: 'Test payload',
      validate: isJsonObject,
      invalidShapeMessage: 'Test payload must be an object'
    })

    expect(result).toEqual({
      ok: false,
      error: 'Test payload must be an object'
    })
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', '']
  ])('rejects %s input', (_label, value) => {
    const result = safeJsonParse(value, { context: 'Test payload' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Test payload')
    }
  })
})
