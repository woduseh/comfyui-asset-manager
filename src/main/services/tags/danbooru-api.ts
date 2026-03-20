import { ofetch, FetchError } from 'ofetch'
import { DANBOORU_REQUEST_TIMEOUT_MS } from '../../constants'
import log from '../../logger'

const DANBOORU_BASE = 'https://danbooru.donmai.us'

export interface DanbooruApiTag {
  id: number
  name: string
  category: number
  post_count: number
  is_deprecated: boolean
}

const apiCache = new Map<string, DanbooruApiTag | null>()

export function clearApiCache(): void {
  apiCache.clear()
}

export async function validateTagOnline(name: string): Promise<DanbooruApiTag | null> {
  const key = `validate:${name}`
  if (apiCache.has(key)) return apiCache.get(key)!

  try {
    const results = await ofetch<DanbooruApiTag[]>(`${DANBOORU_BASE}/tags.json`, {
      params: { 'search[name]': name, limit: 1 },
      timeout: DANBOORU_REQUEST_TIMEOUT_MS
    })
    const tag = results.length > 0 ? results[0] : null
    apiCache.set(key, tag)
    return tag
  } catch (error) {
    if (error instanceof FetchError) {
      log.warn(`[Tags] Danbooru API error for "${name}":`, error.message)
    }
    return null
  }
}

export async function searchTagsOnline(query: string, limit = 20): Promise<DanbooruApiTag[]> {
  const key = `search:${query}:${limit}`
  if (apiCache.has(key)) return [apiCache.get(key)!].filter(Boolean)

  try {
    const nameMatch = query.includes('*') ? query : `*${query}*`
    const results = await ofetch<DanbooruApiTag[]>(`${DANBOORU_BASE}/tags.json`, {
      params: {
        'search[name_matches]': nameMatch,
        'search[order]': 'count',
        limit
      },
      timeout: DANBOORU_REQUEST_TIMEOUT_MS
    })

    for (const tag of results) {
      apiCache.set(`validate:${tag.name}`, tag)
    }

    return results
  } catch (error) {
    if (error instanceof FetchError) {
      log.warn(`[Tags] Danbooru API search error for "${query}":`, error.message)
    }
    return []
  }
}
