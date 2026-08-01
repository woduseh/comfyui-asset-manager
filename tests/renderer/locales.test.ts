import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/src/locales/en.json'
import ko from '../../src/renderer/src/locales/ko.json'

function collectLeafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix]

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectLeafKeys(child, prefix ? `${prefix}.${key}` : key)
  )
}

describe('renderer locales', () => {
  it('keeps Korean and English translation keys in sync', () => {
    expect(collectLeafKeys(ko).sort()).toEqual(collectLeafKeys(en).sort())
  })

  it('describes gallery removal as metadata-only and preserves original files', () => {
    expect(ko.gallery.viewer.confirmDelete).toContain('원본 파일은 유지')
    expect(ko.gallery.viewer.deleteImage).toContain('갤러리에서 제거')
    expect(en.gallery.viewer.confirmDelete).toContain('original file will be kept')
    expect(en.gallery.viewer.deleteImage).toBe('Remove from Gallery')
  })
})
