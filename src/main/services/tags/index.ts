import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateTagOnline, searchTagsOnline } from './danbooru-api'

export interface DanbooruTag {
  id: number
  name: string
  category: number
  count: number
}

export interface TagValidationResult {
  tag: string
  valid: boolean
  postCount?: number
  category?: string
  source?: 'local' | 'online'
  suggestions?: string[]
}

const CATEGORY_NAMES: Record<number, string> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  9: 'rating'
}

const CATEGORY_IDS: Record<string, number> = {
  general: 0,
  artist: 1,
  copyright: 3,
  character: 4,
  meta: 5,
  rating: 9
}

const SEMANTIC_GROUPS: Record<string, RegExp[]> = {
  composition: [/^(1girl|1boy|solo|multiple_girls|multiple_boys|2girls|2boys|couple)$/],
  hair_color: [/_hair$/, /^(blonde|brown|black|red|blue|green|white|silver|pink|purple|grey|orange)_hair$/],
  hair_style: [
    /^(long|short|medium)_hair$/,
    /ponytail/,
    /twintails/,
    /braid/,
    /bob_cut/,
    /^bangs$/,
    /side_ponytail/,
    /hair_bun/,
    /twin_braids/,
    /low_ponytail/
  ],
  eye_color: [/_eyes$/],
  expression: [
    /^(smile|blush|open_mouth|closed_eyes|crying|angry|frown|grin|pout|surprised|nervous)$/,
    /^looking_at_viewer$/,
    /^closed_mouth$/,
    /^:d$/i
  ],
  clothing: [
    /dress/,
    /skirt/,
    /^shirt$/,
    /uniform/,
    /armor/,
    /jacket/,
    /boots/,
    /thighhighs/,
    /pantyhose/,
    /swimsuit/,
    /bikini/,
    /kimono/,
    /leotard/
  ],
  accessories: [
    /hair_ornament/,
    /ribbon/,
    /^bow$/,
    /jewelry/,
    /necklace/,
    /earrings/,
    /hat$/,
    /gloves/,
    /glasses/,
    /headband/
  ],
  pose: [/^(standing|sitting|lying|kneeling|walking|running|from_behind|from_above|from_below)$/],
  body: [/^(breasts|large_breasts|small_breasts|thighs|navel|midriff|bare_shoulders|collarbone)$/],
  background: [
    /background$/,
    /^(outdoors|indoors)$/,
    /^(sky|night|sunset|sunrise|rain|snow|water)$/,
    /^(city|forest|beach|school|bedroom|classroom)$/
  ]
}

class TagService {
  private tags = new Map<string, DanbooruTag>()
  private tagsByCount: DanbooruTag[] = []
  private loaded = false

  load(customPath?: string): void {
    const tagFilePath =
      customPath || (app.isPackaged
        ? join(process.resourcesPath, 'Danbooru Tag.txt')
        : join(__dirname, '../../resources/Danbooru Tag.txt'))

    try {
      const content = readFileSync(tagFilePath, 'utf-8')
      const lines = content.split('\n')

      // Skip header line
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const parts = line.split(',')
        if (parts.length < 4) continue

        const tag: DanbooruTag = {
          id: parseInt(parts[0], 10),
          name: parts[1],
          category: parseInt(parts[2], 10),
          count: parseInt(parts[3], 10)
        }

        this.tags.set(tag.name, tag)
      }

      this.tagsByCount = Array.from(this.tags.values()).sort((a, b) => b.count - a.count)
      this.loaded = true
      console.log(`[Tags] Loaded ${this.tags.size} tags from local database`)
    } catch (error) {
      console.error('[Tags] Failed to load tag file:', error)
      this.loaded = false
    }
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getTagCount(): number {
    return this.tags.size
  }

  lookupLocal(name: string): DanbooruTag | undefined {
    return this.tags.get(name)
  }

  async validate(
    tags: string[],
    onlineFallback = true
  ): Promise<TagValidationResult[]> {
    const results: TagValidationResult[] = []

    for (const tagName of tags) {
      const normalized = tagName.trim().toLowerCase().replace(/\s+/g, '_')
      const localTag = this.tags.get(normalized)

      if (localTag) {
        results.push({
          tag: normalized,
          valid: true,
          postCount: localTag.count,
          category: CATEGORY_NAMES[localTag.category] || 'unknown',
          source: 'local'
        })
        continue
      }

      // Online fallback
      if (onlineFallback) {
        const onlineTag = await validateTagOnline(normalized)
        if (onlineTag && !onlineTag.is_deprecated) {
          results.push({
            tag: normalized,
            valid: true,
            postCount: onlineTag.post_count,
            category: CATEGORY_NAMES[onlineTag.category] || 'unknown',
            source: 'online'
          })
          continue
        }
      }

      // Invalid tag — provide suggestions
      const suggestions = this.suggestSimilar(normalized, 5)
      results.push({
        tag: normalized,
        valid: false,
        suggestions: suggestions.length > 0 ? suggestions : undefined
      })
    }

    return results
  }

  search(query: string, category?: string, limit = 20): DanbooruTag[] {
    const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, '_')
    const catId = category ? CATEGORY_IDS[category] : undefined
    const results: DanbooruTag[] = []

    const hasWildcard = normalizedQuery.includes('*')

    if (hasWildcard) {
      const regexStr = normalizedQuery.replace(/\*/g, '.*').replace(/\?/g, '.')
      const regex = new RegExp(`^${regexStr}$`)

      for (const tag of this.tagsByCount) {
        if (catId !== undefined && tag.category !== catId) continue
        if (regex.test(tag.name)) {
          results.push(tag)
          if (results.length >= limit) break
        }
      }
    } else {
      // Exact match first
      const exact = this.tags.get(normalizedQuery)
      if (exact && (catId === undefined || exact.category === catId)) {
        results.push(exact)
      }

      // Prefix matches
      for (const tag of this.tagsByCount) {
        if (results.length >= limit) break
        if (catId !== undefined && tag.category !== catId) continue
        if (tag.name === normalizedQuery) continue
        if (tag.name.startsWith(normalizedQuery)) {
          results.push(tag)
        }
      }

      // Substring matches (if not enough results)
      if (results.length < limit) {
        for (const tag of this.tagsByCount) {
          if (results.length >= limit) break
          if (catId !== undefined && tag.category !== catId) continue
          if (tag.name.startsWith(normalizedQuery)) continue // already added
          if (tag.name.includes(normalizedQuery)) {
            results.push(tag)
          }
        }
      }
    }

    return results
  }

  async searchWithOnline(
    query: string,
    category?: string,
    limit = 20
  ): Promise<DanbooruTag[]> {
    const localResults = this.search(query, category, limit)

    if (localResults.length >= limit) return localResults

    // Supplement with online results
    try {
      const remaining = limit - localResults.length
      const onlineResults = await searchTagsOnline(query, remaining)
      const localNames = new Set(localResults.map((t) => t.name))

      for (const online of onlineResults) {
        if (localNames.has(online.name)) continue
        if (category && CATEGORY_IDS[category] !== undefined && online.category !== CATEGORY_IDS[category]) continue
        localResults.push({
          id: online.id,
          name: online.name,
          category: online.category,
          count: online.post_count
        })
        if (localResults.length >= limit) break
      }
    } catch {
      // Online search failed, return local results only
    }

    return localResults
  }

  getPopular(category?: string, limit = 100): DanbooruTag[] {
    const catId = category ? CATEGORY_IDS[category] : undefined

    if (catId === undefined) {
      return this.tagsByCount.slice(0, limit)
    }

    const results: DanbooruTag[] = []
    for (const tag of this.tagsByCount) {
      if (tag.category === catId) {
        results.push(tag)
        if (results.length >= limit) break
      }
    }
    return results
  }

  getPopularGrouped(): Record<string, string[]> {
    const groups: Record<string, string[]> = {}

    for (const [groupName, patterns] of Object.entries(SEMANTIC_GROUPS)) {
      const matched: DanbooruTag[] = []

      for (const tag of this.tagsByCount) {
        for (const pattern of patterns) {
          if (pattern.test(tag.name)) {
            matched.push(tag)
            break
          }
        }
      }

      groups[groupName] = matched.slice(0, 30).map((t) => t.name)
    }

    return groups
  }

  suggestSimilar(tag: string, limit = 5): string[] {
    const scored: Array<{ name: string; score: number }> = []

    for (const [name, tagData] of this.tags) {
      // Skip very long or very short comparisons
      if (Math.abs(name.length - tag.length) > 5) continue

      const distance = levenshtein(tag, name)
      // Normalize by max length, lower is better
      const maxLen = Math.max(tag.length, name.length)
      const similarity = 1 - distance / maxLen

      if (similarity >= 0.4) {
        // Boost score by popularity (log scale)
        const popularityBoost = Math.log10(tagData.count + 1) / 10
        scored.push({ name, score: similarity + popularityBoost })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((s) => s.name)
  }

  formatTagsForDisplay(tags: DanbooruTag[]): Array<{ name: string; category: string; post_count: number }> {
    return tags.map((t) => ({
      name: t.name,
      category: CATEGORY_NAMES[t.category] || 'unknown',
      post_count: t.count
    }))
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }

  return dp[m][n]
}

export const tagService = new TagService()
export { CATEGORY_NAMES, CATEGORY_IDS, SEMANTIC_GROUPS }
