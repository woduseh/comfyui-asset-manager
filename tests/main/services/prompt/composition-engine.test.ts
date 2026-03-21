import { describe, it, expect } from 'vitest'
import {
  applyWeight,
  resolveWildcards,
  interpolateVariables,
  combineFragments,
  buildPrompt,
  previewPrompt,
  type PromptFragment
} from '../../../../src/main/services/prompt/composition-engine'

describe('Prompt Composition Engine', () => {
  describe('applyWeight', () => {
    it('returns text unchanged when weight is 1.0', () => {
      expect(applyWeight('masterpiece', 1.0)).toBe('masterpiece')
    })

    it('returns text unchanged when weight is close to 1.0', () => {
      expect(applyWeight('masterpiece', 1.005)).toBe('masterpiece')
      expect(applyWeight('masterpiece', 0.995)).toBe('masterpiece')
    })

    it('wraps text in weight format when weight differs from 1.0', () => {
      expect(applyWeight('masterpiece', 1.2)).toBe('(masterpiece:1.20)')
      expect(applyWeight('bad quality', 0.5)).toBe('(bad quality:0.50)')
    })

    it('trims whitespace from text', () => {
      expect(applyWeight('  masterpiece  ', 1.0)).toBe('masterpiece')
      expect(applyWeight('  masterpiece  ', 1.5)).toBe('(masterpiece:1.50)')
    })

    it('returns empty string for empty/whitespace text', () => {
      expect(applyWeight('', 1.0)).toBe('')
      expect(applyWeight('   ', 1.5)).toBe('')
    })

    it('formats weight to 2 decimal places', () => {
      expect(applyWeight('text', 1.333)).toBe('(text:1.33)')
      expect(applyWeight('text', 2.0)).toBe('(text:2.00)')
    })
  })

  describe('resolveWildcards', () => {
    it('resolves single wildcard with seed for determinism', () => {
      const result1 = resolveWildcards('{red|blue|green}', 42)
      const result2 = resolveWildcards('{red|blue|green}', 42)
      expect(result1).toBe(result2) // deterministic with same seed
      expect(['red', 'blue', 'green']).toContain(result1)
    })

    it('returns different results with different seeds', () => {
      const results = new Set<string>()
      for (let seed = 0; seed < 1000; seed++) {
        results.add(resolveWildcards('{red|blue|green}', seed))
      }
      // With 1000 seeds and 3 options, we should get more than 1 unique result
      expect(results.size).toBeGreaterThan(1)
    })

    it('resolves multiple wildcards in one string', () => {
      const result = resolveWildcards('{red|blue} hair, {happy|sad} face', 42)
      expect(result).not.toContain('{')
      expect(result).not.toContain('}')
    })

    it('leaves text without wildcards unchanged', () => {
      expect(resolveWildcards('no wildcards here', 42)).toBe('no wildcards here')
    })

    it('handles single-option wildcard', () => {
      expect(resolveWildcards('{only}', 42)).toBe('only')
    })

    it('trims whitespace in options', () => {
      const result = resolveWildcards('{ red | blue | green }', 42)
      expect(result).not.toMatch(/^\s/)
      expect(result).not.toMatch(/\s$/)
    })
  })

  describe('interpolateVariables', () => {
    it('replaces known variables', () => {
      const result = interpolateVariables('hello {{name}}', { name: 'world' })
      expect(result).toBe('hello world')
    })

    it('leaves unknown variables as-is', () => {
      const result = interpolateVariables('hello {{unknown}}', { name: 'world' })
      expect(result).toBe('hello {{unknown}}')
    })

    it('replaces multiple variables', () => {
      const result = interpolateVariables('{{char}} wears {{outfit}}', {
        char: 'Alice',
        outfit: 'dress'
      })
      expect(result).toBe('Alice wears dress')
    })

    it('handles empty variables map', () => {
      expect(interpolateVariables('{{name}}', {})).toBe('{{name}}')
    })

    it('handles text without variables', () => {
      expect(interpolateVariables('plain text', { name: 'val' })).toBe('plain text')
    })

    it('handles empty string', () => {
      expect(interpolateVariables('', { name: 'val' })).toBe('')
    })
  })

  describe('combineFragments', () => {
    it('combines positive and negative fragments', () => {
      const fragments: PromptFragment[] = [
        { text: 'masterpiece', negative: 'bad quality', weight: 1.0 },
        { text: '1girl', negative: 'ugly', weight: 1.0 }
      ]
      const result = combineFragments(fragments)
      expect(result.positive).toBe('masterpiece, 1girl')
      expect(result.negative).toBe('bad quality, ugly')
    })

    it('applies weight to positive text', () => {
      const fragments: PromptFragment[] = [
        { text: 'masterpiece', weight: 1.2 },
        { text: 'detailed', weight: 1.0 }
      ]
      const result = combineFragments(fragments)
      expect(result.positive).toBe('(masterpiece:1.20), detailed')
    })

    it('handles empty fragments', () => {
      const result = combineFragments([])
      expect(result.positive).toBe('')
      expect(result.negative).toBe('')
    })

    it('skips fragments with empty text', () => {
      const fragments: PromptFragment[] = [
        { text: '', weight: 1.0 },
        { text: 'masterpiece', weight: 1.0 }
      ]
      const result = combineFragments(fragments)
      expect(result.positive).toBe('masterpiece')
    })

    it('skips fragments with empty negative', () => {
      const fragments: PromptFragment[] = [
        { text: 'a', negative: '', weight: 1.0 },
        { text: 'b', negative: 'bad', weight: 1.0 }
      ]
      const result = combineFragments(fragments)
      expect(result.negative).toBe('bad')
    })
  })

  describe('buildPrompt', () => {
    it('orders modules by type priority', () => {
      const modules = [
        { type: 'emotion', items: [{ prompt: 'happy', negative: '', weight: 1.0, enabled: true }] },
        {
          type: 'quality',
          items: [{ prompt: 'masterpiece', negative: '', weight: 1.0, enabled: true }]
        },
        {
          type: 'character',
          items: [{ prompt: '1girl', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = buildPrompt(modules, undefined, 42)
      // quality → character → emotion
      expect(result.positive).toBe('masterpiece, 1girl, happy')
    })

    it('skips disabled items', () => {
      const modules = [
        {
          type: 'quality',
          items: [
            { prompt: 'masterpiece', negative: '', weight: 1.0, enabled: true },
            { prompt: 'best quality', negative: '', weight: 1.0, enabled: false }
          ]
        }
      ]
      const result = buildPrompt(modules)
      expect(result.positive).toBe('masterpiece')
    })

    it('handles negative-type modules by moving prompt to negative', () => {
      const modules = [
        {
          type: 'quality',
          items: [{ prompt: 'masterpiece', negative: '', weight: 1.0, enabled: true }]
        },
        {
          type: 'negative',
          items: [{ prompt: 'worst quality, ugly', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = buildPrompt(modules, undefined, 42)
      expect(result.positive).toBe('masterpiece')
      expect(result.negative).toBe('worst quality, ugly')
    })

    it('applies variables and wildcards', () => {
      const modules = [
        {
          type: 'character',
          items: [
            {
              prompt: '{{name}}, {red|red} hair',
              negative: '',
              weight: 1.0,
              enabled: true
            }
          ]
        }
      ]
      const result = buildPrompt(modules, { name: 'Alice' }, 42)
      expect(result.positive).toBe('Alice, red hair')
    })

    it('applies weight formatting', () => {
      const modules = [
        {
          type: 'quality',
          items: [{ prompt: 'masterpiece', negative: '', weight: 1.5, enabled: true }]
        }
      ]
      const result = buildPrompt(modules)
      expect(result.positive).toBe('(masterpiece:1.50)')
    })

    it('returns empty strings for no modules', () => {
      const result = buildPrompt([])
      expect(result.positive).toBe('')
      expect(result.negative).toBe('')
    })

    it('combines negatives only from negative modules', () => {
      const modules = [
        {
          type: 'character',
          items: [{ prompt: '1girl', negative: 'bad anatomy', weight: 1.0, enabled: true }]
        },
        {
          type: 'negative',
          items: [{ prompt: 'worst quality', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = buildPrompt(modules, undefined, 42)
      expect(result.positive).toBe('1girl')
      expect(result.negative).not.toContain('bad anatomy')
      expect(result.negative).toContain('worst quality')
    })
  })

  describe('previewPrompt', () => {
    it('does not resolve wildcards', () => {
      const modules = [
        {
          type: 'character',
          items: [{ prompt: '{red|blue} hair', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = previewPrompt(modules)
      expect(result.positive).toBe('{red|blue} hair')
    })

    it('does interpolate variables', () => {
      const modules = [
        {
          type: 'character',
          items: [{ prompt: '{{name}} hair', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = previewPrompt(modules, { name: 'Alice' })
      expect(result.positive).toBe('Alice hair')
    })

    it('orders modules the same as buildPrompt', () => {
      const modules = [
        { type: 'emotion', items: [{ prompt: 'happy', negative: '', weight: 1.0, enabled: true }] },
        {
          type: 'quality',
          items: [{ prompt: 'masterpiece', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = previewPrompt(modules)
      expect(result.positive).toBe('masterpiece, happy')
    })

    it('handles negative modules', () => {
      const modules = [
        {
          type: 'negative',
          items: [{ prompt: 'worst quality', negative: '', weight: 1.0, enabled: true }]
        }
      ]
      const result = previewPrompt(modules)
      expect(result.positive).toBe('')
      expect(result.negative).toBe('worst quality')
    })
  })
})
