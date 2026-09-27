import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const network = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('ofetch', () => ({ ofetch: network.fetch, FetchError: class FetchError extends Error {} }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
let directory = ''
let tags: typeof import('@main/services/tags').tagService
beforeEach(async () => {
  vi.resetModules()
  network.fetch.mockReset()
  directory = mkdtempSync(join(tmpdir(), 'comfy-tags-contract-'))
  const file = join(directory, 'tags.csv')
  writeFileSync(
    file,
    'id,name,category,count\n1,blue_eyes,0,1000\n2,rem_(re:zero),4,100\n3,cat,0,100\n4,bat,0,100\n5,rat,0,100\n6,a.b+[x],0,10\n'
  )
  tags = (await import('@main/services/tags')).tagService
  tags.load(file)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

describe('tag lookup transport and literal wildcard contracts', () => {
  it('keeps a failed lookup unknown after a successful online probe', async () => {
    network.fetch.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('timeout'))
    const result = await tags.validate(['absent'])
    expect(result.results[0]).toMatchObject({ tag: 'absent', valid: null, source: 'unverified' })
    expect(result.onlineAvailable).toBe(false)
  })
  it('uses only local data when every normalized tag is known', async () => {
    const result = await tags.validate(['Blue Eyes', 'BLUE_EYES'])
    expect(result.results.map((row) => row.valid)).toEqual([true, true])
    expect(network.fetch).not.toHaveBeenCalled()
  })
  it('distinguishes confirmed misses, exact matches and transport failures without caching failures', async () => {
    const { validateTagOnline } = await import('@main/services/tags/danbooru-api')
    network.fetch.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce([])
    expect(await validateTagOnline('missing')).toEqual({ kind: 'unavailable' })
    expect(await validateTagOnline('missing')).toEqual({ kind: 'not_found' })
    expect(await validateTagOnline('missing')).toEqual({ kind: 'not_found' })
    expect(network.fetch).toHaveBeenCalledTimes(2)
    network.fetch.mockResolvedValueOnce([
      { id: 7, name: 'unexpected', category: 0, post_count: 10, is_deprecated: false }
    ])
    expect(await validateTagOnline('requested')).toEqual({ kind: 'not_found' })
  })
  it('expires successful lookup cache entries so corrected tags can be rechecked', async () => {
    vi.useFakeTimers()
    const { validateTagOnline } = await import('@main/services/tags/danbooru-api')
    network.fetch.mockResolvedValueOnce([])
    expect(await validateTagOnline('new_tag')).toEqual({ kind: 'not_found' })
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    const tag = { id: 8, name: 'new_tag', category: 0, post_count: 10, is_deprecated: false }
    network.fetch.mockResolvedValueOnce([tag])
    expect(await validateTagOnline('new_tag')).toEqual({ kind: 'found', tag })
  })
  it('escapes punctuation while treating only asterisks as wildcards', () => {
    expect(tags.search('rem_(re:zero)*').map((tag) => tag.name)).toEqual(['rem_(re:zero)'])
    expect(tags.search('rem_(*').map((tag) => tag.name)).toEqual(['rem_(re:zero)'])
    expect(tags.search('a.b+[x]*').map((tag) => tag.name)).toEqual(['a.b+[x]'])
  })
  it('keeps stable ranking for equal similarity and popularity while bounding top-k', () => {
    expect(tags.suggestSimilar('hat', 2)).toEqual(['cat', 'bat'])
    expect(tags.suggestSimilar('hat', 0)).toEqual([])
  })
})
