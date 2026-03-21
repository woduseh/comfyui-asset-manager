import { describe, it, expect } from 'vitest'
import { extractTagsFromPrompt, replaceTagInPrompt } from '../../../../src/main/services/tags/utils'

describe('Tag Utilities', () => {
  describe('extractTagsFromPrompt', () => {
    it('extracts comma-separated tags', () => {
      expect(extractTagsFromPrompt('1girl, blue_eyes, long_hair')).toEqual([
        '1girl',
        'blue_eyes',
        'long_hair'
      ])
    })

    it('trims whitespace', () => {
      expect(extractTagsFromPrompt('  tag1 ,  tag2  , tag3  ')).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('removes empty entries', () => {
      expect(extractTagsFromPrompt('tag1,,tag2, ,tag3')).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('returns empty array for empty/null input', () => {
      expect(extractTagsFromPrompt('')).toEqual([])
      expect(extractTagsFromPrompt('  ')).toEqual([])
    })

    it('preserves weight syntax', () => {
      expect(extractTagsFromPrompt('(blue_eyes:1.2), long_hair')).toEqual([
        '(blue_eyes:1.2)',
        'long_hair'
      ])
    })
  })

  describe('replaceTagInPrompt', () => {
    it('replaces exact tag match', () => {
      expect(replaceTagInPrompt('1girl, blue_eyes, long_hair', 'blue_eyes', 'red_eyes')).toBe(
        '1girl, red_eyes, long_hair'
      )
    })

    it('does not replace substring matches', () => {
      const prompt = '1girl, folded_arms, arms_crossed'
      expect(replaceTagInPrompt(prompt, 'arms', 'legs')).toBe(prompt)
    })

    it('is case-insensitive', () => {
      expect(replaceTagInPrompt('1girl, Blue_Eyes', 'blue_eyes', 'red_eyes')).toBe(
        '1girl, red_eyes'
      )
    })

    it('deletes tag when newTag is empty', () => {
      expect(replaceTagInPrompt('1girl, blue_eyes, long_hair', 'blue_eyes', '')).toBe(
        '1girl, long_hair'
      )
    })

    it('preserves weight syntax on replacement', () => {
      expect(replaceTagInPrompt('(blue_eyes:1.2), long_hair', 'blue_eyes', 'red_eyes')).toBe(
        '(red_eyes:1.2), long_hair'
      )
    })

    it('handles single tag prompt', () => {
      expect(replaceTagInPrompt('blue_eyes', 'blue_eyes', 'red_eyes')).toBe('red_eyes')
    })

    it('handles tag at start', () => {
      expect(replaceTagInPrompt('blue_eyes, long_hair', 'blue_eyes', 'red_eyes')).toBe(
        'red_eyes, long_hair'
      )
    })

    it('handles tag at end', () => {
      expect(replaceTagInPrompt('1girl, blue_eyes', 'blue_eyes', 'red_eyes')).toBe(
        '1girl, red_eyes'
      )
    })

    it('returns original if tag not found', () => {
      const prompt = '1girl, blue_eyes'
      expect(replaceTagInPrompt(prompt, 'red_eyes', 'green_eyes')).toBe(prompt)
    })

    it('returns original for empty/null prompt', () => {
      expect(replaceTagInPrompt('', 'tag', 'new')).toBe('')
      expect(replaceTagInPrompt('  ', 'tag', 'new')).toBe('  ')
    })

    it('replaces multiple occurrences of same tag', () => {
      expect(replaceTagInPrompt('blue_eyes, 1girl, blue_eyes', 'blue_eyes', 'red_eyes')).toBe(
        'red_eyes, 1girl, red_eyes'
      )
    })

    it('deletes tag and cleans up separators', () => {
      expect(replaceTagInPrompt('1girl, blue_eyes, long_hair', 'blue_eyes', '')).toBe(
        '1girl, long_hair'
      )
    })
  })
})
