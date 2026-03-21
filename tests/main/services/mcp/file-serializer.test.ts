import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../../src/main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: { file: { level: 'info', maxSize: 0 }, console: { level: 'debug' } }
  }
}))

import { serializeModuleItems } from '../../../../src/main/services/mcp/file-serializer'
import { parseModuleItemsContent } from '../../../../src/main/services/mcp/file-parser'
import type { ParsedModuleItem } from '../../../../src/main/services/mcp/file-parser'

const sampleItems: ParsedModuleItem[] = [
  { name: 'Alice', prompt: '1girl, alice, blue_eyes', negative: 'lowres' },
  { name: 'Bob', prompt: '1boy, bob' },
  {
    name: 'Carol',
    prompt: '1girl, carol',
    prompt_variants: { tags: { prompt: 'tag_prompt', negative: 'tag_neg' } }
  }
]

describe('File Serializer', () => {
  describe('JSON format', () => {
    it('serializes items to JSON', () => {
      const json = serializeModuleItems(sampleItems, 'json')
      const parsed = JSON.parse(json)
      expect(parsed).toHaveLength(3)
      expect(parsed[0].name).toBe('Alice')
      expect(parsed[0].prompt).toBe('1girl, alice, blue_eyes')
      expect(parsed[0].negative).toBe('lowres')
      expect(parsed[1].negative).toBeUndefined()
      expect(parsed[2].prompt_variants).toBeDefined()
    })

    it('roundtrips JSON (serialize→parse)', () => {
      const json = serializeModuleItems(sampleItems, 'json')
      const result = parseModuleItemsContent(json, 'json')
      expect(result.items).toHaveLength(3)
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].prompt).toBe('1girl, alice, blue_eyes')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('CSV format', () => {
    it('serializes items to CSV with header', () => {
      const csv = serializeModuleItems(sampleItems, 'csv')
      const lines = csv.split('\n')
      expect(lines[0]).toContain('name')
      expect(lines[0]).toContain('prompt')
      expect(lines[0]).toContain('negative')
      expect(lines.length).toBe(4) // header + 3 items
    })

    it('handles commas in prompts via quoting', () => {
      const csv = serializeModuleItems(
        [{ name: 'Test', prompt: '1girl, blue_eyes, long_hair' }],
        'csv'
      )
      expect(csv).toContain('"1girl, blue_eyes, long_hair"')
    })

    it('roundtrips CSV (serialize→parse)', () => {
      const csv = serializeModuleItems(sampleItems, 'csv')
      const result = parseModuleItemsContent(csv, 'csv')
      expect(result.items).toHaveLength(3)
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].prompt).toBe('1girl, alice, blue_eyes')
    })
  })

  describe('Markdown format', () => {
    it('serializes items to Markdown', () => {
      const md = serializeModuleItems(sampleItems, 'md')
      expect(md).toContain('## Alice')
      expect(md).toContain('1girl, alice, blue_eyes')
      expect(md).toContain('### Negative')
      expect(md).toContain('lowres')
      expect(md).toContain('## Bob')
    })

    it('omits Negative section when empty', () => {
      const md = serializeModuleItems([{ name: 'Test', prompt: 'prompt' }], 'md')
      expect(md).not.toContain('Negative')
    })

    it('roundtrips Markdown (serialize→parse)', () => {
      const simpleItems: ParsedModuleItem[] = [
        { name: 'Alice', prompt: '1girl, alice', negative: 'lowres' },
        { name: 'Bob', prompt: '1boy, bob' }
      ]
      const md = serializeModuleItems(simpleItems, 'md')
      const result = parseModuleItemsContent(md, 'md')
      expect(result.items).toHaveLength(2)
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].negative).toBe('lowres')
    })
  })

  describe('empty items', () => {
    it('handles empty array for all formats', () => {
      expect(serializeModuleItems([], 'json')).toBe('[]')
      expect(serializeModuleItems([], 'csv')).toBe('name,prompt')
      expect(serializeModuleItems([], 'md')).toBe('')
    })
  })
})
