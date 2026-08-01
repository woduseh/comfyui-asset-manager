import { describe, expect, it } from 'vitest'
import {
  formatGalleryFileSize,
  parseGalleryGenerationParams
} from '../../src/renderer/src/utils/gallery'

describe('gallery utilities', () => {
  it('formats byte sizes for gallery metadata', () => {
    expect(formatGalleryFileSize(null)).toBe('-')
    expect(formatGalleryFileSize(512)).toBe('512 B')
    expect(formatGalleryFileSize(1536)).toBe('1.5 KB')
    expect(formatGalleryFileSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('parses only object-shaped generation metadata', () => {
    expect(parseGalleryGenerationParams('{"seed":42}')).toEqual({ seed: 42 })
    expect(parseGalleryGenerationParams('[]')).toBeNull()
    expect(parseGalleryGenerationParams('invalid')).toBeNull()
  })
})
