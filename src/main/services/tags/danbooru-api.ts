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

export type OnlineTagLookup =
  | { kind: 'found'; tag: DanbooruApiTag }
  | { kind: 'not_found' }
  | { kind: 'unavailable' }

const apiCache = new Map<
  string,
  { result: Exclude<OnlineTagLookup, { kind: 'unavailable' }>; expiresAt: number }
>()
const MAX_CACHE_ENTRIES = 512
function cacheResult(key: string, result: Exclude<OnlineTagLookup, { kind: 'unavailable' }>): void {
  if (apiCache.size >= MAX_CACHE_ENTRIES) apiCache.delete(apiCache.keys().next().value!)
  apiCache.set(key, { result, expiresAt: Date.now() + DANBOORU_ONLINE_CACHE_TTL_MS })
}

let onlineAvailable: boolean | null = null
let onlineCheckedAt = 0

export async function checkOnlineAvailability(): Promise<boolean> {
  const now = Date.now()
  if (onlineAvailable !== null && now - onlineCheckedAt < DANBOORU_ONLINE_CACHE_TTL_MS) {
    return onlineAvailable
  }

  try {
    await ofetch(`${DANBOORU_BASE}/tags.json`, {
      params: { 'search[name]': '1girl', limit: 1 },
      retry: 0,
      timeout: DANBOORU_PROBE_TIMEOUT_MS
    })
    onlineAvailable = true
    onlineCheckedAt = now
    log.info('[Tags] Danbooru API is reachable')
    return true
  } catch (error) {
    log.debug('[Tags] Danbooru availability probe failed:', error)
    onlineAvailable = false
    onlineCheckedAt = now
    log.info('[Tags] Danbooru API is unreachable, skipping online lookups')
    return false
  }
}

export async function validateTagOnline(name: string): Promise<OnlineTagLookup> {
  const key = `validate:${name}`
  const cached = apiCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  apiCache.delete(key)

  try {
    const results = await ofetch<DanbooruApiTag[]>(`${DANBOORU_BASE}/tags.json`, {
      params: { 'search[name]': name, limit: 1 },
      retry: 0,
      timeout: DANBOORU_REQUEST_TIMEOUT_MS
    })
    const tag = results.find((tag) => tag.name === name)
    const result: Exclude<OnlineTagLookup, { kind: 'unavailable' }> = tag
      ? { kind: 'found', tag }
      : { kind: 'not_found' }
    cacheResult(key, result)
    return result
  } catch (error) {
    if (error instanceof FetchError) {
      log.warn(`[Tags] Danbooru API error for "${name}":`, error.message)
    }
    return { kind: 'unavailable' }
  }
}

export async function searchTagsOnline(query: string, limit = 20): Promise<DanbooruApiTag[]> {
  try {
    const nameMatch = query.includes('*') ? query : `*${query}*`
    const results = await ofetch<DanbooruApiTag[]>(`${DANBOORU_BASE}/tags.json`, {
      params: {
        'search[name_matches]': nameMatch,
        'search[order]': 'count',
        limit
      },
      retry: 0,
      timeout: DANBOORU_REQUEST_TIMEOUT_MS
    })

    for (const tag of results) {
      cacheResult(`validate:${tag.name}`, { kind: 'found', tag })
    }

    return results
  } catch (error) {
    if (error instanceof FetchError) {
      log.warn(`[Tags] Danbooru API search error for "${query}":`, error.message)
    }
    return []
  }
}
