/**
 * Prompt Composition Engine
 *
 * Combines prompt modules and items into a final prompt string.
 * Supports: weight formatting, variable interpolation, wildcard expansion.
 */

export interface PromptFragment {
  text: string
  negative?: string
  weight: number
}

/**
 * Apply weight to a prompt string. Returns `(text:weight)` if weight != 1.0
 */
export function applyWeight(text: string, weight: number): string {
  if (!text.trim()) return ''
  if (Math.abs(weight - 1.0) < 0.01) return text.trim()
  return `(${text.trim()}:${weight.toFixed(2)})`
}

/**
 * Resolve wildcard expressions like `{red|blue|green}` by picking a random option.
 * Uses deterministic LCG when seed is provided.
 */
export function resolveWildcards(text: string, seed?: number): string {
  let rngState = seed ?? Math.floor(Math.random() * 2147483647)

  function nextRandom(): number {
    rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff
    return rngState / 0x7fffffff
  }

  return text.replace(/\{([^}]+)\}/g, (_match, group: string) => {
    const options = group.split('|').map((s) => s.trim())
    if (options.length === 0) return ''
    const index = Math.floor(nextRandom() * options.length)
    return options[index]
  })
}

/**
 * Interpolate variables in text: `{{variable_name}}` → value
 */
export function interpolateVariables(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    return variables[varName] ?? `{{${varName}}}`
  })
}

/**
 * Combine multiple prompt fragments into a single comma-separated prompt string.
 */
export function combineFragments(fragments: PromptFragment[]): {
  positive: string
  negative: string
} {
  const positives: string[] = []
  const negatives: string[] = []

  for (const frag of fragments) {
    const weighted = applyWeight(frag.text, frag.weight)
    if (weighted) positives.push(weighted)

    if (frag.negative?.trim()) {
      negatives.push(frag.negative.trim())
    }
  }

  return {
    positive: positives.join(', '),
    negative: negatives.join(', ')
  }
}

/**
 * Build a complete prompt from module items.
 * Order: quality → style → artist → character → outfit → emotion → lora → custom
 */
export function buildPrompt(
  modules: Array<{
    type: string
    items: Array<{
      prompt: string
      negative: string
      weight: number
      enabled: boolean
    }>
  }>,
  variables?: Record<string, string>,
  seed?: number
): { positive: string; negative: string } {
  const typeOrder = [
    'quality',
    'style',
    'artist',
    'character',
    'outfit',
    'emotion',
    'lora',
    'negative',
    'custom'
  ]

  const sorted = [...modules].sort((a, b) => {
    const ia = typeOrder.indexOf(a.type)
    const ib = typeOrder.indexOf(b.type)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })

  const fragments: PromptFragment[] = []

  for (const mod of sorted) {
    for (const item of mod.items) {
      if (!item.enabled) continue

      let promptText = item.prompt
      let negativeText = item.negative || ''

      if (variables) {
        promptText = interpolateVariables(promptText, variables)
        negativeText = interpolateVariables(negativeText, variables)
      }

      promptText = resolveWildcards(promptText, seed)
      negativeText = resolveWildcards(negativeText, seed)

      // 'negative' type modules contribute to negative prompt only
      if (mod.type === 'negative') {
        fragments.push({ text: '', negative: promptText, weight: item.weight })
      } else {
        fragments.push({ text: promptText, negative: negativeText, weight: item.weight })
      }
    }
  }

  return combineFragments(fragments)
}

/**
 * Preview combined prompt without resolving wildcards.
 */
export function previewPrompt(
  modules: Array<{
    type: string
    items: Array<{
      prompt: string
      negative: string
      weight: number
      enabled: boolean
    }>
  }>,
  variables?: Record<string, string>
): { positive: string; negative: string } {
  const typeOrder = [
    'quality',
    'style',
    'artist',
    'character',
    'outfit',
    'emotion',
    'lora',
    'negative',
    'custom'
  ]

  const sorted = [...modules].sort((a, b) => {
    const ia = typeOrder.indexOf(a.type)
    const ib = typeOrder.indexOf(b.type)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })

  const positives: string[] = []
  const negatives: string[] = []

  for (const mod of sorted) {
    for (const item of mod.items) {
      if (!item.enabled) continue

      let promptText = item.prompt
      let negativeText = item.negative || ''

      if (variables) {
        promptText = interpolateVariables(promptText, variables)
        negativeText = interpolateVariables(negativeText, variables)
      }

      if (mod.type === 'negative') {
        if (promptText.trim()) negatives.push(applyWeight(promptText, item.weight))
      } else {
        const weighted = applyWeight(promptText, item.weight)
        if (weighted) positives.push(weighted)
        if (negativeText.trim()) negatives.push(negativeText.trim())
      }
    }
  }

  return {
    positive: positives.join(', '),
    negative: negatives.join(', ')
  }
}
