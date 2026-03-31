import { describe, expect, it } from 'vitest'
import { parseIntegerOrFallback } from '../../src/renderer/src/utils/number'

describe('renderer parseIntegerOrFallback', () => {
  it('parses valid base-10 integer strings', () => {
    expect(parseIntegerOrFallback('8188', 80)).toBe(8188)
  })

  it('returns the fallback for invalid integers', () => {
    expect(parseIntegerOrFallback('oops', 80)).toBe(80)
  })

  it('returns the fallback for blank values', () => {
    expect(parseIntegerOrFallback('', 39464)).toBe(39464)
  })
})
