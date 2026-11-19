import { mkdtemp, readdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createThumbnailResponse,
  THUMBNAIL_MAX_EDGE,
  type ThumbnailImage,
  type ThumbnailResponseDeps
} from '../../../../src/main/services/assets/thumbnail'

function fakeImage(alpha: number, empty = false): ThumbnailImage {
  return {
    isEmpty: () => empty,
    toBitmap: () => Buffer.from([10, 20, 30, 255, 10, 20, 30, alpha]),
    toJPEG: () => Buffer.from('jpeg'),
    toPNG: () => Buffer.from('png')
  }
}

let workDirectory: string
let source: string
let cacheDirectory: string
let generated: Array<{ width: number; height: number }>

function deps(overrides: Partial<ThumbnailResponseDeps> = {}): ThumbnailResponseDeps {
  return {
    cacheDirectory,
    createThumbnail: async (_path, size) => {
      generated.push(size)
      return fakeImage(255)
    },
    fetchOriginal: () => new Response('original'),
    ...overrides
  }
}

beforeEach(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'thumbnail-test-'))
  source = join(workDirectory, 'image.png')
  cacheDirectory = join(workDirectory, 'cache')
  generated = []
  await writeFile(source, 'png bytes')
})

afterEach(async () => {
  await rm(workDirectory, { recursive: true, force: true })
})

describe('createThumbnailResponse', () => {
  it('generates a bounded JPEG once and serves later requests from the cache', async () => {
    const first = await createThumbnailResponse(source, deps())
    const second = await createThumbnailResponse(source, deps())

    expect(generated).toEqual([{ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE }])
    expect(first.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await second.text()).toBe('jpeg')
    expect(second.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('regenerates the thumbnail when the source file changes', async () => {
    await createThumbnailResponse(source, deps())
    await writeFile(source, 'regenerated png bytes')
    await utimes(source, new Date(), new Date(Date.now() + 5_000))
    await createThumbnailResponse(source, deps())

    expect(generated).toHaveLength(2)
  })

  it('keeps transparency by encoding a translucent image as PNG', async () => {
    const response = await createThumbnailResponse(
      source,
      deps({ createThumbnail: async () => fakeImage(0) })
    )

    expect(response.headers.get('Content-Type')).toBe('image/png')
  })

  it.each([
    ['throws', async (): Promise<ThumbnailImage> => Promise.reject(new Error('unsupported'))],
    ['returns an empty image', async (): Promise<ThumbnailImage> => fakeImage(255, true)]
  ])('serves the original without caching when the thumbnailer %s', async (_case, create) => {
    const fallbacks: string[] = []
    const response = await createThumbnailResponse(
      source,
      deps({ createThumbnail: create, onFallback: (path) => fallbacks.push(path) })
    )

    expect(await response.text()).toBe('original')
    expect(fallbacks).toEqual([source])
    await expect(readdir(cacheDirectory)).rejects.toThrow()
  })

  it('serves the original for a missing source so the file error reaches the image', async () => {
    let thumbnailRequested = false
    const response = await createThumbnailResponse(
      join(workDirectory, 'missing.png'),
      deps({
        createThumbnail: async () => {
          thumbnailRequested = true
          return fakeImage(255)
        },
        fetchOriginal: () => new Response('not found', { status: 404 })
      })
    )

    expect(response.status).toBe(404)
    expect(thumbnailRequested).toBe(false)
  })

  it('still serves the thumbnail when the cache cannot be written', async () => {
    await writeFile(cacheDirectory, 'a file where the cache directory should be')
    const failures: string[] = []

    const response = await createThumbnailResponse(
      source,
      deps({ onCacheWriteFailed: (path) => failures.push(path) })
    )

    expect(await response.text()).toBe('jpeg')
    expect(failures).toEqual([source])
  })
})
