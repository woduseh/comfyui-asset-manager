import { describe, expect, it } from 'vitest'
import { isJsonObject, safeJsonParse } from '../../src/renderer/src/utils/safe-json'

describe('renderer safeJsonParse', () => {
  it('returns a parsed value when JSON is valid and passes validation', () => {
    const result = safeJsonParse<Record<string, unknown>>('{"name":"Alice"}', {
      context: 'Renderer payload',
      validate: isJsonObject,
      invalidShapeMessage: 'Renderer payload must be an object'
    })

    expect(result).toEqual({
      ok: true,
      value: { name: 'Alice' }
    })
  })

  it('returns an error when JSON is invalid', () => {
    const result = safeJsonParse('{', { context: 'Renderer payload' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Renderer payload')
      expect(result.error).toContain('valid JSON')
    }
  })

  it('returns an error when validation fails', () => {
    const result = safeJsonParse<Record<string, unknown>>('[]', {
      context: 'Renderer payload',
      validate: isJsonObject,
      invalidShapeMessage: 'Renderer payload must be an object'
    })

    expect(result).toEqual({
      ok: false,
      error: 'Renderer payload must be an object'
    })
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', '']
  ])('rejects %s input', (_label, value) => {
    const result = safeJsonParse(value, { context: 'Renderer payload' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Renderer payload')
    }
  })
})
