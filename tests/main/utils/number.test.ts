import { describe, expect, it } from 'vitest'
import { parseIntegerOrFallback } from '../../../src/main/utils/number'

describe('parseIntegerOrFallback', () => {
  it('parses valid base-10 integer strings', () => {
    expect(parseIntegerOrFallback('42', 3)).toBe(42)
  })

  it('returns the fallback for invalid integers', () => {
    expect(parseIntegerOrFallback('not-a-number', 3)).toBe(3)
  })

  it('returns the fallback for blank values', () => {
    expect(parseIntegerOrFallback('   ', 7)).toBe(7)
  })
})
