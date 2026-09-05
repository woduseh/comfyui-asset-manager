import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { resolve } from 'path'

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  list: vi.fn(),
  tracked: vi.fn(),
  rating: vi.fn(),
  favorite: vi.fn(),
  settings: vi.fn(),
  flush: vi.fn(),
  transaction: vi.fn((fn: () => unknown) => fn()),
  realpath: vi.fn((path: string) => path),
  stat: vi.fn(),
  createImage: vi.fn()
}))
vi.mock('electron', () => ({ nativeImage: { createFromPath: mocks.createImage } }))
vi.mock('fs', () => ({
  realpathSync: { native: mocks.realpath },
  statSync: mocks.stat
}))
vi.mock('../../../../src/main/services/database', () => ({
  withTransaction: mocks.transaction,
  flushDatabase: mocks.flush
}))
vi.mock('../../../../src/main/services/database/repositories', () => ({
  GeneratedImageRepository: class {
    get = (): Record<string, unknown> | null => mocks.row
    list = mocks.list
    hasTrackedAssetPath = mocks.tracked
    updateRating = mocks.rating
    updateFavorite = mocks.favorite
  },
  SettingsRepository: class {
    get = mocks.settings
  }
}))

import { registerGalleryTools } from '../../../../src/main/services/mcp/tools/gallery'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
function registeredTools(): Map<string, { schema: z.ZodObject<z.ZodRawShape>; handler: Handler }> {
  const handlers = new Map<string, { schema: z.ZodObject<z.ZodRawShape>; handler: Handler }>()
  registerGalleryTools({
    tool: (name: string, _description: string, schema: z.ZodRawShape, handler: Handler) => {
      handlers.set(name, { schema: z.object(schema), handler })
    }
  } as unknown as McpServer)
  return handlers
}
async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = registeredTools().get(name)!
  return tool.handler(tool.schema.parse(args))
}
function body(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0]
  if (content.type !== 'text') throw new Error('Expected JSON text')
  return JSON.parse(content.text)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.row = {
    id: 'image-1',
    job_id: 'job-1',
    file_path: resolve('output', 'image.png'),
    generation_params: '{"seed":123}',
    prompt_text: 'blue_eyes',
    negative_text: '',
    rating: 0,
    is_favorite: 0,
    width: 4096,
    height: 2048
  }
  mocks.settings.mockReturnValue(resolve('output'))
  mocks.realpath.mockImplementation((path) => path)
  mocks.tracked.mockReturnValue(false)
  mocks.stat.mockReturnValue({ isFile: () => true, size: 1024 })
  mocks.list.mockReturnValue({ items: [mocks.row], total: 25 })
  mocks.rating.mockImplementation((_id, value) => {
    mocks.row!.rating = value
  })
  mocks.favorite.mockImplementation((_id, value) => {
    mocks.row!.is_favorite = value ? 1 : 0
  })
  mocks.flush.mockResolvedValue(undefined)
  mocks.createImage.mockReturnValue({
    isEmpty: () => false,
    getSize: () => ({ width: 4096, height: 2048 }),
    resize: vi.fn(() => ({
      getSize: () => ({ width: 1024, height: 512 }),
      toJPEG: () => Buffer.from('jpeg-data')
    }))
  })
})

describe('MCP gallery tools', () => {
  it('lists bounded summaries with false favorite filters preserved', async () => {
    const result = body(await call('list_generated_images', { job_id: 'job-1', favorite: false }))
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', isFavorite: false, page: 1, pageSize: 20 })
    )
    expect(result).toMatchObject({ total: 25, page_size: 20, has_more: true })
    expect((result.items as object[])[0]).not.toHaveProperty('generation_params')
  })

  it.each([{ page: 0 }, { page_size: 101 }, { page_size: -1 }, { min_rating: 1.5 }])(
    'rejects invalid pagination and ratings: %j',
    async (args) => {
      await expect(call('list_generated_images', args)).rejects.toThrow()
      expect(mocks.list).not.toHaveBeenCalled()
    }
  )

  it('returns actual bounded MCP image content and parsed metadata', async () => {
    const result = await call('get_generated_image', { id: 'image-1' })
    expect(body(result)).toMatchObject({
      generation_params: { seed: 123 },
      preview: { width: 1024, height: 512 }
    })
    expect(result.content[1]).toEqual({
      type: 'image',
      data: Buffer.from('jpeg-data').toString('base64'),
      mimeType: 'image/jpeg'
    })
    expect(mocks.createImage.mock.results[0].value.resize).toHaveBeenCalledWith({
      width: 1024,
      height: 512,
      quality: 'good'
    })
  })

  it('returns metadata without touching the filesystem when requested', async () => {
    mocks.row!.generation_params = 'bad json'
    const result = await call('get_generated_image', { id: 'image-1', include_image: false })
    expect(body(result)).toMatchObject({
      generation_params: null,
      generation_params_error: expect.any(String)
    })
    expect(mocks.stat).not.toHaveBeenCalled()
  })

  it('rejects unknown IDs before reading files or updating review state', async () => {
    mocks.row = null
    expect((await call('get_generated_image', { id: 'missing' })).isError).toBe(true)
    expect((await call('review_generated_image', { id: 'missing', rating: 3 })).isError).toBe(true)
    expect(mocks.createImage).not.toHaveBeenCalled()
    expect(mocks.rating).not.toHaveBeenCalled()
  })

  it('blocks a symlink escape even if the original requested path was registered', async () => {
    const requested = mocks.row!.file_path as string
    const escaped = resolve('private', 'secret.png')
    mocks.realpath.mockImplementation((path) => (path === requested ? escaped : path))
    mocks.tracked.mockImplementation((paths: string[]) => paths.includes(requested))
    const result = await call('get_generated_image', { id: 'image-1' })
    expect(result.isError).toBe(true)
    expect(body(result).preview_error).toContain('boundary')
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.tracked).toHaveBeenCalledWith([escaped])
  })

  it('allows registered original assets outside the current output root', async () => {
    mocks.row!.file_path = resolve('old-output', 'image.png')
    mocks.tracked.mockReturnValue(true)
    const result = await call('get_generated_image', { id: 'image-1' })
    expect(result.isError).not.toBe(true)
    expect(mocks.createImage).toHaveBeenCalledWith(mocks.row!.file_path)
  })

  it('reports missing files and decoding failures without changing gallery data', async () => {
    mocks.stat.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    expect((await call('get_generated_image', { id: 'image-1' })).isError).toBe(true)
    mocks.createImage.mockReturnValueOnce({ isEmpty: () => true })
    expect((await call('get_generated_image', { id: 'image-1' })).isError).toBe(true)
    expect(mocks.rating).not.toHaveBeenCalled()
    expect(mocks.favorite).not.toHaveBeenCalled()
  })

  it('rejects oversized source files before decoding', async () => {
    mocks.stat.mockReturnValue({ isFile: () => true, size: 65 * 1024 * 1024 })
    expect((await call('get_generated_image', { id: 'image-1' })).isError).toBe(true)
    expect(mocks.createImage).not.toHaveBeenCalled()
  })

  it('does not return an oversized encoded preview', async () => {
    mocks.createImage.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 100, height: 100 }),
      resize: () => ({ toJPEG: () => Buffer.alloc(2 * 1024 * 1024 + 1) })
    })
    const result = await call('get_generated_image', { id: 'image-1' })
    expect(result.isError).toBe(true)
    expect(result.content.every((content) => content.type !== 'image')).toBe(true)
  })

  it('persists rating and favorite together and confirms the stored result', async () => {
    const result = await call('review_generated_image', {
      id: 'image-1',
      rating: 5,
      favorite: true
    })
    expect(body(result)).toMatchObject({ success: true, image: { rating: 5, favorite: true } })
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(mocks.stat).not.toHaveBeenCalled()
  })

  it('reports persistence failures instead of returning success', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('disk full'))
    const result = await call('review_generated_image', { id: 'image-1', favorite: false })
    expect(result.isError).toBe(true)
    expect(body(result).error).toContain('not confirmed persisted')
    expect(body(result).error).toContain('disk full')
  })

  it('reports repository failures without confirming persistence', async () => {
    mocks.rating.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const result = await call('review_generated_image', {
      id: 'image-1',
      rating: 4,
      favorite: true
    })
    expect(result.isError).toBe(true)
    expect(mocks.favorite).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('allows clearing both a rating and a favorite', async () => {
    const result = await call('review_generated_image', {
      id: 'image-1',
      rating: 0,
      favorite: false
    })
    expect(body(result)).toMatchObject({ success: true, image: { rating: 0, favorite: false } })
    expect(mocks.rating).toHaveBeenCalledWith('image-1', 0)
    expect(mocks.favorite).toHaveBeenCalledWith('image-1', false)
  })

  it('does not persist an empty review', async () => {
    expect((await call('review_generated_image', { id: 'image-1' })).isError).toBe(true)
    expect(mocks.flush).not.toHaveBeenCalled()
  })
})
