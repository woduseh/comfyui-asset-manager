import { describe, it, expect } from 'vitest'
import { parseModuleItemsContent } from '../../../../src/main/services/mcp/file-parser'

describe('File Parser', () => {
  describe('JSON format', () => {
    it('parses valid JSON array', () => {
      const content = JSON.stringify([
        { name: 'Alice', prompt: '1girl, alice' },
        { name: 'Bob', prompt: '1boy, bob', negative: 'lowres' }
      ])
      const result = parseModuleItemsContent(content, 'json')
      expect(result.items).toHaveLength(2)
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].prompt).toBe('1girl, alice')
      expect(result.items[1].negative).toBe('lowres')
      expect(result.errors).toHaveLength(0)
    })

    it('parses JSON with prompt_variants', () => {
      const content = JSON.stringify([
        {
          name: 'Alice',
          prompt: '1girl',
          prompt_variants: { tags: { prompt: 'tag_prompt', negative: 'tag_neg' } }
        }
      ])
      const result = parseModuleItemsContent(content, 'json')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].prompt_variants).toEqual({
        tags: { prompt: 'tag_prompt', negative: 'tag_neg' }
      })
    })

    it('reports errors for invalid entries', () => {
      const content = JSON.stringify([
        { name: 'Valid', prompt: 'ok' },
        { name: '', prompt: 'missing name' },
        { prompt: 'no name field' },
        { name: 'No prompt' }
      ])
      const result = parseModuleItemsContent(content, 'json')
      expect(result.items).toHaveLength(1)
      expect(result.errors).toHaveLength(3)
    })

    it('rejects non-array JSON', () => {
      const result = parseModuleItemsContent('{"key": "value"}', 'json')
      expect(result.items).toHaveLength(0)
      expect(result.errors[0].error).toContain('array')
    })

    it('handles invalid JSON gracefully', () => {
      const result = parseModuleItemsContent('not json at all', 'json')
      expect(result.items).toHaveLength(0)
      expect(result.errors[0].error).toContain('Invalid JSON')
    })
  })

  describe('CSV format', () => {
    it('parses basic CSV', () => {
      const content = 'name,prompt,negative\nAlice,"1girl, alice",""\nBob,"1boy, bob",lowres'
      const result = parseModuleItemsContent(content, 'csv')
      expect(result.items).toHaveLength(2)
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].prompt).toBe('1girl, alice')
      expect(result.items[1].negative).toBe('lowres')
      expect(result.errors).toHaveLength(0)
    })

    it('handles quoted fields with commas', () => {
      const content = 'name,prompt\nAlice,"1girl, blue_eyes, long_hair"'
      const result = parseModuleItemsContent(content, 'csv')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].prompt).toBe('1girl, blue_eyes, long_hair')
    })

    it('handles escaped quotes in CSV', () => {
      const content = 'name,prompt\nAlice,"prompt with ""quotes"""'
      const result = parseModuleItemsContent(content, 'csv')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].prompt).toBe('prompt with "quotes"')
    })

    it('reports error for missing required columns', () => {
      const content = 'name,description\nAlice,some desc'
      const result = parseModuleItemsContent(content, 'csv')
      expect(result.items).toHaveLength(0)
      expect(result.errors[0].error).toContain('prompt')
    })

    it('reports error for header-only CSV', () => {
      const result = parseModuleItemsContent('name,prompt', 'csv')
      expect(result.items).toHaveLength(0)
      expect(result.errors[0].error).toContain('header + data')
    })

    it('skips rows with empty name or prompt', () => {
      const content = 'name,prompt\n,empty_name\nAlice,ok\nBob,'
      const result = parseModuleItemsContent(content, 'csv')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Alice')
      expect(result.errors).toHaveLength(2)
    })
  })

  describe('Markdown format', () => {
    it('parses basic markdown with ## headers', () => {
      const content = '## Alice\n1girl, alice, blue_eyes\n\n## Bob\n1boy, bob'
      const result = parseModuleItemsContent(content, 'md')
      expect(result.items).toHaveLength(2)
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].prompt).toBe('1girl, alice, blue_eyes')
      expect(result.items[1].name).toBe('Bob')
      expect(result.items[1].prompt).toBe('1boy, bob')
    })

    it('concatenates multi-line prompts with commas', () => {
      const content = '## Alice\n1girl\nalice\nblue_eyes'
      const result = parseModuleItemsContent(content, 'md')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].prompt).toBe('1girl, alice, blue_eyes')
    })

    it('parses negative section with ### Negative', () => {
      const content = '## Alice\n1girl, alice\n### Negative\nlowres, bad'
      const result = parseModuleItemsContent(content, 'md')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].prompt).toBe('1girl, alice')
      expect(result.items[0].negative).toBe('lowres, bad')
    })

    it('parses negative section with **negative** marker', () => {
      const content = '## Alice\n1girl, alice\n**negative**\nlowres'
      const result = parseModuleItemsContent(content, 'md')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].negative).toBe('lowres')
    })

    it('reports error for headers with empty prompt', () => {
      const content = '## EmptyItem\n\n## ValidItem\nprompt here'
      const result = parseModuleItemsContent(content, 'md')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('ValidItem')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toContain('empty prompt')
    })

    it('ignores content before first ## header', () => {
      const content = 'Some intro text\n\n## Alice\n1girl'
      const result = parseModuleItemsContent(content, 'md')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Alice')
    })
  })
})
