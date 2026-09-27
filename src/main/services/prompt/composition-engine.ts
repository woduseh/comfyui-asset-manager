/**
 * Prompt Composition Engine
 *
 * Combines prompt modules and items into a final prompt string.
 * Supports: weight formatting, variable interpolation, wildcard expansion.
 */

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
export function interpolateVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    return variables[varName] ?? `{{${varName}}}`
  })
}

interface PromptModule {
  type: string
  items: Array<{ prompt: string; negative: string; weight: number; enabled: boolean }>
}
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

function composePrompt(
  modules: PromptModule[],
  variables: Record<string, string> | undefined,
  expandWildcards: boolean,
  seed?: number
): { positive: string; negative: string } {
  const priority = (type: string): number => {
    const index = typeOrder.indexOf(type)
    return index < 0 ? typeOrder.length : index
  }
  const sorted = [...modules].sort((a, b) => priority(a.type) - priority(b.type))
  const positives: string[] = []
  const negatives: string[] = []
  for (const module of sorted) {
    for (const item of module.items) {
      if (!item.enabled) continue
      let text = variables ? interpolateVariables(item.prompt, variables) : item.prompt
      if (expandWildcards) text = resolveWildcards(text, seed)
      const weighted = applyWeight(text, item.weight)
      // Only negative modules contribute to the negative prompt; legacy item.negative is retained data.
      if (weighted) (module.type === 'negative' ? negatives : positives).push(weighted)
    }
  }
  return { positive: positives.join(', '), negative: negatives.join(', ') }
}

/** Build and preview share all policies except deterministic wildcard expansion. */
export function buildPrompt(
  modules: PromptModule[],
  variables?: Record<string, string>,
  seed?: number
): { positive: string; negative: string } {
  return composePrompt(modules, variables, true, seed)
}

export function previewPrompt(
  modules: PromptModule[],
  variables?: Record<string, string>
): { positive: string; negative: string } {
  return composePrompt(modules, variables, false)
}
