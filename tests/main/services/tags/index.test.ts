import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest'
import path from 'path'

// Mock electron app
vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

// Mock the Danbooru API module
vi.mock('../../../../src/main/services/tags/danbooru-api', () => ({
  validateTagOnline: vi.fn(),
  searchTagsOnline: vi.fn(),
  clearApiCache: vi.fn()
}))

import { tagService, CATEGORY_NAMES, CATEGORY_IDS } from '../../../../src/main/services/tags/index'
import { validateTagOnline, searchTagsOnline } from '../../../../src/main/services/tags/danbooru-api'

const TAG_FILE_PATH = path.resolve(__dirname, '../../../../resources/Danbooru Tag.txt')

describe('TagService', () => {
  beforeAll(() => {
    tagService.load(TAG_FILE_PATH)
  })

  describe('load', () => {
    it('should load tags from file', () => {
      expect(tagService.isLoaded()).toBe(true)
      expect(tagService.getTagCount()).toBeGreaterThan(6000)
    })
  })

  describe('lookupLocal', () => {
    it('should find existing tags', () => {
      const tag = tagService.lookupLocal('long_hair')
      expect(tag).toBeDefined()
      expect(tag!.name).toBe('long_hair')
      expect(tag!.count).toBeGreaterThan(0)
    })

    it('should return undefined for non-existent tags', () => {
      const tag = tagService.lookupLocal('completely_made_up_tag_xyz')
      expect(tag).toBeUndefined()
    })
  })

  describe('validate', () => {
    beforeEach(() => {
      vi.mocked(validateTagOnline).mockReset()
    })

    it('should validate existing local tags', async () => {
      const results = await tagService.validate(['blue_eyes', 'long_hair', 'smile'], false)

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.valid)).toBe(true)
      expect(results[0].source).toBe('local')
      expect(results[0].postCount).toBeGreaterThan(0)
    })

    it('should mark non-existent tags as invalid', async () => {
      const results = await tagService.validate(['fake_tag_xyz'], false)

      expect(results).toHaveLength(1)
      expect(results[0].valid).toBe(false)
      expect(results[0].tag).toBe('fake_tag_xyz')
    })

    it('should provide suggestions for invalid tags', async () => {
      const results = await tagService.validate(['blue_eye'], false)

      expect(results).toHaveLength(1)
      expect(results[0].valid).toBe(false)
      expect(results[0].suggestions).toBeDefined()
      expect(results[0].suggestions!.length).toBeGreaterThan(0)
      expect(results[0].suggestions).toContain('blue_eyes')
    })

    it('should normalize tags (spaces to underscores, lowercase)', async () => {
      const results = await tagService.validate(['Blue Eyes', 'LONG HAIR'], false)

      expect(results).toHaveLength(2)
      expect(results[0].tag).toBe('blue_eyes')
      expect(results[0].valid).toBe(true)
      expect(results[1].tag).toBe('long_hair')
      expect(results[1].valid).toBe(true)
    })

    it('should use online fallback for unknown tags', async () => {
      vi.mocked(validateTagOnline).mockResolvedValueOnce({
        id: 99999,
        name: 'rare_online_tag',
        category: 0,
        post_count: 50,
        is_deprecated: false
      })

      const results = await tagService.validate(['rare_online_tag'], true)

      expect(results).toHaveLength(1)
      expect(results[0].valid).toBe(true)
      expect(results[0].source).toBe('online')
      expect(validateTagOnline).toHaveBeenCalledWith('rare_online_tag')
    })

    it('should reject deprecated online tags', async () => {
      vi.mocked(validateTagOnline).mockResolvedValueOnce({
        id: 99999,
        name: 'deprecated_tag',
        category: 0,
        post_count: 10,
        is_deprecated: true
      })

      const results = await tagService.validate(['deprecated_tag'], true)

      expect(results).toHaveLength(1)
      expect(results[0].valid).toBe(false)
    })
  })

  describe('search', () => {
    it('should find tags by exact name', () => {
      const results = tagService.search('blue_eyes')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].name).toBe('blue_eyes')
    })

    it('should find tags by prefix', () => {
      const results = tagService.search('blue_')
      expect(results.length).toBeGreaterThan(1)
      expect(results.every((r) => r.name.startsWith('blue_') || r.name.includes('blue_'))).toBe(true)
    })

    it('should support wildcard patterns', () => {
      const results = tagService.search('*_hair')
      expect(results.length).toBeGreaterThan(5)
      expect(results.every((r) => r.name.endsWith('_hair'))).toBe(true)
    })

    it('should respect category filter', () => {
      const results = tagService.search('*', 'rating')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.every((r) => r.category === CATEGORY_IDS['rating'])).toBe(true)
    })

    it('should respect limit parameter', () => {
      const results = tagService.search('*', undefined, 5)
      expect(results.length).toBeLessThanOrEqual(5)
    })

    it('should return results sorted by popularity', () => {
      const results = tagService.search('*_eyes')
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].count).toBeGreaterThanOrEqual(results[i].count)
      }
    })
  })

  describe('searchWithOnline', () => {
    beforeEach(() => {
      vi.mocked(searchTagsOnline).mockReset()
    })

    it('should supplement local results with online results', async () => {
      vi.mocked(searchTagsOnline).mockResolvedValueOnce([
        { id: 1, name: 'rare_tag_from_api', category: 0, post_count: 100, is_deprecated: false }
      ])

      const results = await tagService.searchWithOnline('rare_tag_from', undefined, 20)
      // Should include at least the online result
      expect(searchTagsOnline).toHaveBeenCalled()
    })
  })

  describe('getPopular', () => {
    it('should return tags sorted by post count', () => {
      const results = tagService.getPopular(undefined, 10)
      expect(results).toHaveLength(10)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].count).toBeGreaterThanOrEqual(results[i].count)
      }
    })

    it('should filter by category', () => {
      const results = tagService.getPopular('rating', 10)
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.every((r) => r.category === 9)).toBe(true)
    })

    it('should respect limit', () => {
      const results = tagService.getPopular(undefined, 50)
      expect(results).toHaveLength(50)
    })
  })

  describe('getPopularGrouped', () => {
    it('should return tags grouped by semantic category', () => {
      const groups = tagService.getPopularGrouped()

      expect(groups).toHaveProperty('hair_color')
      expect(groups).toHaveProperty('eye_color')
      expect(groups).toHaveProperty('expression')
      expect(groups).toHaveProperty('clothing')
      expect(groups).toHaveProperty('pose')
      expect(groups).toHaveProperty('accessories')
      expect(groups).toHaveProperty('background')

      expect(groups.hair_color.length).toBeGreaterThan(0)
      expect(groups.eye_color.length).toBeGreaterThan(0)
    })

    it('should include known tags in correct groups', () => {
      const groups = tagService.getPopularGrouped()

      expect(groups.hair_color).toContain('blonde_hair')
      expect(groups.eye_color).toContain('blue_eyes')
    })
  })

  describe('suggestSimilar', () => {
    it('should suggest similar tags for typos', () => {
      const suggestions = tagService.suggestSimilar('blue_eye')
      expect(suggestions).toContain('blue_eyes')
    })

    it('should suggest similar tags for close matches', () => {
      const suggestions = tagService.suggestSimilar('long_har')
      expect(suggestions).toContain('long_hair')
    })

    it('should respect limit parameter', () => {
      const suggestions = tagService.suggestSimilar('blue', 3)
      expect(suggestions.length).toBeLessThanOrEqual(3)
    })

    it('should return empty array for very different input', () => {
      const suggestions = tagService.suggestSimilar('xyzabcdefghijklmnop')
      expect(suggestions).toHaveLength(0)
    })
  })

  describe('formatTagsForDisplay', () => {
    it('should format tags with human-readable category names', () => {
      const tags = [{ id: 1, name: 'blue_eyes', category: 0, count: 1000 }]
      const formatted = tagService.formatTagsForDisplay(tags)

      expect(formatted).toEqual([{
        name: 'blue_eyes',
        category: 'general',
        post_count: 1000
      }])
    })
  })
})

describe('Constants', () => {
  it('CATEGORY_NAMES should map all known categories', () => {
    expect(CATEGORY_NAMES[0]).toBe('general')
    expect(CATEGORY_NAMES[1]).toBe('artist')
    expect(CATEGORY_NAMES[3]).toBe('copyright')
    expect(CATEGORY_NAMES[4]).toBe('character')
    expect(CATEGORY_NAMES[5]).toBe('meta')
    expect(CATEGORY_NAMES[9]).toBe('rating')
  })

  it('CATEGORY_IDS should be inverse of CATEGORY_NAMES', () => {
    expect(CATEGORY_IDS['general']).toBe(0)
    expect(CATEGORY_IDS['artist']).toBe(1)
    expect(CATEGORY_IDS['copyright']).toBe(3)
    expect(CATEGORY_IDS['character']).toBe(4)
    expect(CATEGORY_IDS['meta']).toBe(5)
    expect(CATEGORY_IDS['rating']).toBe(9)
  })
})
