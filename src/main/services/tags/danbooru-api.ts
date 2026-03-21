import { ofetch, FetchError } from 'ofetch'
import {
  DANBOORU_REQUEST_TIMEOUT_MS,
  DANBOORU_PROBE_TIMEOUT_MS,
  DANBOORU_ONLINE_CACHE_TTL_MS
} from '../../constants'
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

let onlineAvailable: boolean | null = null
let onlineCheckedAt = 0

export function clearApiCache(): void {
  apiCache.clear()
}

export function resetOnlineStatus(): void {
  onlineAvailable = null
  onlineCheckedAt = 0
}

export async function checkOnlineAvailability(): Promise<boolean> {
  const now = Date.now()
  if (onlineAvailable !== null && now - onlineCheckedAt < DANBOORU_ONLINE_CACHE_TTL_MS) {
    return onlineAvailable
  }

  try {
    await ofetch(`${DANBOORU_BASE}/tags.json`, {
      params: { 'search[name]': '1girl', limit: 1 },
      timeout: DANBOORU_PROBE_TIMEOUT_MS
    })
    onlineAvailable = true
    onlineCheckedAt = now
    log.info('[Tags] Danbooru API is reachable')
    return true
  } catch {
    onlineAvailable = false
    onlineCheckedAt = now
    log.info('[Tags] Danbooru API is unreachable, skipping online lookups')
    return false
  }
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
