import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../../../src/main/utils/external-url'

describe('isAllowedExternalUrl', () => {
  it.each(['https://example.com/docs', 'http://localhost:8188/'])('allows %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'mailto:user@example.com',
    'local-asset://image/test.png',
    'not a url'
  ])('rejects %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })
})
