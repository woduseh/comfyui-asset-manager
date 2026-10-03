import { describe, it, expect } from 'vitest'
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

// CSV includes blank optional columns; Markdown deliberately exports only base prompts.
const csvItems: ParsedModuleItem[] = [
  sampleItems[0],
  { ...sampleItems[1], negative: '' },
  { ...sampleItems[2], negative: '' }
]
const markdownItems: ParsedModuleItem[] = [
  sampleItems[0],
  sampleItems[1],
  { name: 'Carol', prompt: '1girl, carol' }
]

describe('File Serializer', () => {
  it('exports every JSON field and item without adding absent optional fields', () => {
    expect(JSON.parse(serializeModuleItems(sampleItems, 'json'))).toEqual(sampleItems)
  })

  it('exports ordered CSV columns and escapes commas, quotes and variant JSON', () => {
    expect(serializeModuleItems(sampleItems, 'csv')).toBe(
      'name,prompt,negative,prompt_variants\n' +
        'Alice,"1girl, alice, blue_eyes",lowres,\n' +
        'Bob,"1boy, bob",,\n' +
        'Carol,"1girl, carol",,"{""tags"":{""prompt"":""tag_prompt"",""negative"":""tag_neg""}}"'
    )
    const quoted = [{ name: '앨리스 "A"', prompt: 'portrait, "blue eyes"' }]
    const csv = serializeModuleItems(quoted, 'csv')
    expect(csv).toBe('name,prompt\n"앨리스 ""A""","portrait, ""blue eyes"""')
    expect(parseModuleItemsContent(csv, 'csv')).toEqual({
      format: 'csv',
      items: quoted,
      errors: []
    })
  })

  it('exports Markdown item boundaries and only nonempty negative sections', () => {
    expect(serializeModuleItems(sampleItems, 'md')).toBe(
      '## Alice\n1girl, alice, blue_eyes\n### Negative\nlowres\n\n' +
        '## Bob\n1boy, bob\n\n## Carol\n1girl, carol'
    )
  })

  it.each([
    ['json', sampleItems],
    ['csv', csvItems],
    ['md', markdownItems]
  ] as const)(
    'roundtrips all supported %s fields and items without parse errors',
    (format, items) => {
      expect(parseModuleItemsContent(serializeModuleItems(sampleItems, format), format)).toEqual({
        format,
        items,
        errors: []
      })
    }
  )

  it('handles empty arrays in each export format', () => {
    expect(serializeModuleItems([], 'json')).toBe('[]')
    expect(serializeModuleItems([], 'csv')).toBe('name,prompt')
    expect(serializeModuleItems([], 'md')).toBe('')
  })
})
