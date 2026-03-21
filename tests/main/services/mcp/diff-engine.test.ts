import { describe, it, expect } from 'vitest'
import { diffModuleWithItems } from '../../../../src/main/services/mcp/diff-engine'
import type { ParsedModuleItem } from '../../../../src/main/services/mcp/file-parser'

describe('Diff Engine', () => {
  it('detects added items (in file but not in module)', () => {
    const moduleItems = [{ id: '1', name: 'Alice', prompt: '1girl, alice' }]
    const fileItems: ParsedModuleItem[] = [
      { name: 'Alice', prompt: '1girl, alice' },
      { name: 'Bob', prompt: '1boy, bob' }
    ]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].name).toBe('Bob')
    expect(diff.summary.added).toBe(1)
  })

  it('detects removed items (in module but not in file)', () => {
    const moduleItems = [
      { id: '1', name: 'Alice', prompt: '1girl, alice' },
      { id: '2', name: 'Bob', prompt: '1boy, bob' }
    ]
    const fileItems: ParsedModuleItem[] = [{ name: 'Alice', prompt: '1girl, alice' }]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0].name).toBe('Bob')
    expect(diff.summary.removed).toBe(1)
  })

  it('detects modified items with tag-level diff', () => {
    const moduleItems = [{ id: '1', name: 'Alice', prompt: '1girl, alice, blue_eyes' }]
    const fileItems: ParsedModuleItem[] = [
      { name: 'Alice', prompt: '1girl, alice, green_eyes, long_hair' }
    ]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].prompt_diff.added_tags).toContain('green_eyes')
    expect(diff.modified[0].prompt_diff.added_tags).toContain('long_hair')
    expect(diff.modified[0].prompt_diff.removed_tags).toContain('blue_eyes')
  })

  it('detects unchanged items', () => {
    const moduleItems = [
      { id: '1', name: 'Alice', prompt: '1girl, alice' },
      { id: '2', name: 'Bob', prompt: '1boy, bob' }
    ]
    const fileItems: ParsedModuleItem[] = [
      { name: 'Alice', prompt: '1girl, alice' },
      { name: 'Bob', prompt: '1boy, bob' }
    ]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.unchanged_count).toBe(2)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('matches names case-insensitively', () => {
    const moduleItems = [{ id: '1', name: 'Alice', prompt: '1girl' }]
    const fileItems: ParsedModuleItem[] = [{ name: 'alice', prompt: '1girl' }]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.unchanged_count).toBe(1)
    expect(diff.added).toHaveLength(0)
  })

  it('detects negative prompt changes', () => {
    const moduleItems = [{ id: '1', name: 'Alice', prompt: '1girl', negative: 'lowres' }]
    const fileItems: ParsedModuleItem[] = [
      { name: 'Alice', prompt: '1girl', negative: 'lowres, bad_anatomy' }
    ]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].negative_diff).toBeDefined()
    expect(diff.modified[0].negative_diff!.from).toBe('lowres')
    expect(diff.modified[0].negative_diff!.to).toBe('lowres, bad_anatomy')
  })

  it('detects variant changes', () => {
    const moduleItems = [
      {
        id: '1',
        name: 'Alice',
        prompt: '1girl',
        prompt_variants: { tags: { prompt: 'old', negative: '' } }
      }
    ]
    const fileItems: ParsedModuleItem[] = [
      {
        name: 'Alice',
        prompt: '1girl',
        prompt_variants: { tags: { prompt: 'new', negative: '' } }
      }
    ]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].variants_changed).toBe(true)
  })

  it('provides correct summary counts', () => {
    const moduleItems = [
      { id: '1', name: 'Keep', prompt: 'keep' },
      { id: '2', name: 'Change', prompt: 'old' },
      { id: '3', name: 'Remove', prompt: 'gone' }
    ]
    const fileItems: ParsedModuleItem[] = [
      { name: 'Keep', prompt: 'keep' },
      { name: 'Change', prompt: 'new' },
      { name: 'Add', prompt: 'fresh' }
    ]
    const diff = diffModuleWithItems(moduleItems, fileItems)
    expect(diff.summary).toEqual({
      total_in_module: 3,
      total_in_file: 3,
      added: 1,
      removed: 1,
      modified: 1,
      unchanged: 1
    })
  })

  it('handles empty module', () => {
    const diff = diffModuleWithItems([], [{ name: 'Alice', prompt: '1girl' }])
    expect(diff.added).toHaveLength(1)
    expect(diff.summary.total_in_module).toBe(0)
  })

  it('handles empty file', () => {
    const diff = diffModuleWithItems([{ id: '1', name: 'Alice', prompt: '1girl' }], [])
    expect(diff.removed).toHaveLength(1)
    expect(diff.summary.total_in_file).toBe(0)
  })

  it('handles both empty', () => {
    const diff = diffModuleWithItems([], [])
    expect(diff.summary.unchanged).toBe(0)
    expect(diff.summary.added).toBe(0)
  })
})
