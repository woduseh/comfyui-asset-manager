/**
 * Utility functions for Danbooru tag manipulation in prompts.
 * Tags are comma-separated, may include weights like (tag:1.2).
 */

/**
 * Extract individual tags from a comma-separated prompt string.
 * Strips whitespace, removes empty entries, preserves weight syntax.
 */
export function extractTagsFromPrompt(prompt: string): string[] {
  if (!prompt || !prompt.trim()) return []
  return prompt
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * Extract the raw tag name from a possibly weighted tag.
 * e.g. "(blue_eyes:1.2)" → "blue_eyes", "blue_eyes" → "blue_eyes"
 */
function unwrapTag(tag: string): string {
  const match = tag.match(/^\(?\s*([^():]+?)\s*(?::\s*[\d.]+\s*)?\)?$/)
  return match ? match[1].trim() : tag.trim()
}

/**
 * Replace exact tag occurrences in a comma-separated prompt.
 * Matches by raw tag name (ignoring weights), preserves weight syntax on replacement.
 * If newTag is empty string, the tag is removed.
 */
export function replaceTagInPrompt(prompt: string, oldTag: string, newTag: string): string {
  if (!prompt || !prompt.trim()) return prompt

  const tags = prompt.split(',').map((t) => t.trim())
  const normalizedOld = oldTag.trim().toLowerCase()
  let modified = false

  const result = tags
    .map((tag) => {
      if (!tag) return tag
      const raw = unwrapTag(tag).toLowerCase()
      if (raw !== normalizedOld) return tag

      modified = true
      if (!newTag.trim()) return '' // delete tag

      // Preserve weight syntax if present
      const weightMatch = tag.match(/^\(([^():]+?)(:\s*[\d.]+)\s*\)$/)
      if (weightMatch) {
        return `(${newTag.trim()}${weightMatch[2]})`
      }
      return newTag.trim()
    })
    .filter((t) => t.length > 0)

  if (!modified) return prompt
  return result.join(', ')
}
