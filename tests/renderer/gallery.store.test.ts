import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { useGalleryStore } from '../../src/renderer/src/stores/gallery.store'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('gallery.store request scheduling', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    invoke.mockReset()
    Object.defineProperty(globalThis, 'window', {
      value: { electron: { ipcRenderer: { invoke } } },
      configurable: true
    })
  })

  it('coalesces a burst into the active query and latest query without showing stale results', async () => {
    const first = deferred<unknown>()
    const last = deferred<unknown>()
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const store = useGalleryStore()
    const requests = [store.loadImages()]
    await Promise.resolve()

    for (let page = 2; page <= 100; page++) {
      store.setPage(page)
      requests.push(store.loadImages())
    }
    expect(invoke).toHaveBeenCalledTimes(1)
    first.resolve({ items: [{ id: 'stale' }], total: 1 })
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1][1].page).toBe(100)
    expect(store.images).toEqual([])
    expect(store.loading).toBe(true)

    last.resolve({ items: [{ id: 'latest' }], total: 100 })
    await Promise.all(requests)
    expect(store.images[0].id).toBe('latest')
    expect(store.total).toBe(100)
    expect(store.loading).toBe(false)
  })

  it('refreshes again when data changes while the same page is loading', async () => {
    const first = deferred<unknown>()
    invoke.mockReturnValueOnce(first.promise).mockResolvedValue({ items: [], total: 2 })
    const store = useGalleryStore()
    const initial = store.loadImages()
    await Promise.resolve()
    const refresh = store.loadImages()
    first.resolve({ items: [], total: 1 })
    await Promise.all([initial, refresh])
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(store.total).toBe(2)
  })

  it('continues to the latest filters after an obsolete query fails', async () => {
    const first = deferred<unknown>()
    invoke.mockReturnValueOnce(first.promise).mockResolvedValue({ items: [], total: 0 })
    const store = useGalleryStore()
    const initial = store.loadImages()
    await Promise.resolve()
    store.setFilters({ searchText: 'latest' })
    const latest = store.loadImages()
    first.reject(new Error('obsolete failure'))
    await Promise.all([initial, latest])
    expect(invoke.mock.calls[1][1].searchText).toBe('latest')
    expect(store.loading).toBe(false)
  })

  it('propagates current failures, preserves visible data and permits retry', async () => {
    invoke.mockResolvedValueOnce({ items: [{ id: 'existing' }], total: 1 })
    const store = useGalleryStore()
    await store.loadImages()
    invoke.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(store.loadImages()).rejects.toThrow('database unavailable')
    expect(store.images[0].id).toBe('existing')
    expect(store.total).toBe(1)
    expect(store.loading).toBe(false)

    invoke.mockResolvedValueOnce({ items: [], total: 0 })
    await store.loadImages()
    expect(store.images).toEqual([])
    expect(store.total).toBe(0)
  })

  it('does not lose a refresh scheduled by a result watcher', async () => {
    invoke.mockResolvedValueOnce({ items: [], total: 1 }).mockResolvedValue({ items: [], total: 2 })
    const store = useGalleryStore()
    let refresh: Promise<void> | undefined
    const stop = watch(
      () => store.total,
      (total) => {
        if (total === 1) refresh = store.loadImages()
      }
    )
    await store.loadImages()
    await refresh
    stop()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(store.total).toBe(2)
    expect(store.loading).toBe(false)
  })
})
