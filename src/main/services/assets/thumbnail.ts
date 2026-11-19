import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'

export const THUMBNAIL_MAX_EDGE = 512
const THUMBNAIL_JPEG_QUALITY = 85
const CACHED_FORMATS = [
  { extension: 'jpg', contentType: 'image/jpeg' },
  { extension: 'png', contentType: 'image/png' }
] as const

export interface ThumbnailImage {
  isEmpty(): boolean
  toBitmap(): Buffer
  toJPEG(quality: number): Buffer
  toPNG(): Buffer
}

export interface ThumbnailResponseDeps {
  cacheDirectory: string
  createThumbnail: (
    filePath: string,
    size: { width: number; height: number }
  ) => Promise<ThumbnailImage>
  fetchOriginal: (filePath: string) => Response | Promise<Response>
  onFallback?: (filePath: string, reason: unknown) => void
  onCacheWriteFailed?: (filePath: string, error: unknown) => void
}

function hasTransparency(bitmap: Buffer): boolean {
  for (let alpha = 3; alpha < bitmap.length; alpha += 4) {
    if (bitmap[alpha] !== 255) return true
  }
  return false
}

function encodeThumbnail(image: ThumbnailImage): {
  bytes: Buffer
  format: (typeof CACHED_FORMATS)[number]
} {
  return hasTransparency(image.toBitmap())
    ? { bytes: image.toPNG(), format: CACHED_FORMATS[1] }
    : { bytes: image.toJPEG(THUMBNAIL_JPEG_QUALITY), format: CACHED_FORMATS[0] }
}

function imageResponse(bytes: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType } })
}

async function readCachedThumbnail(cacheKeyPath: string): Promise<Response | null> {
  for (const format of CACHED_FORMATS) {
    try {
      return imageResponse(
        await readFile(`${cacheKeyPath}.${format.extension}`),
        format.contentType
      )
    } catch {
      continue
    }
  }
  return null
}

async function writeCachedThumbnail(target: string, bytes: Buffer): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * Serves a downscaled preview cached per file version, or the original file where the
 * platform cannot produce one. Windows generates thumbnails on the main thread, so each
 * version is generated once and later requests read the cached file.
 */
export async function createThumbnailResponse(
  filePath: string,
  deps: ThumbnailResponseDeps
): Promise<Response> {
  let cacheKeyPath: string
  try {
    const source = await stat(filePath)
    const key = createHash('sha256')
      .update(`${THUMBNAIL_MAX_EDGE}|${filePath}|${source.size}|${source.mtimeMs}`)
      .digest('hex')
    cacheKeyPath = join(deps.cacheDirectory, key)
  } catch {
    return deps.fetchOriginal(filePath)
  }

  const cached = await readCachedThumbnail(cacheKeyPath)
  if (cached) return cached

  let image: ThumbnailImage
  try {
    image = await deps.createThumbnail(filePath, {
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE
    })
  } catch (error) {
    deps.onFallback?.(filePath, error)
    return deps.fetchOriginal(filePath)
  }
  if (image.isEmpty()) {
    deps.onFallback?.(filePath, 'empty thumbnail')
    return deps.fetchOriginal(filePath)
  }

  const { bytes, format } = encodeThumbnail(image)
  try {
    await mkdir(deps.cacheDirectory, { recursive: true })
    await writeCachedThumbnail(`${cacheKeyPath}.${format.extension}`, bytes)
  } catch (error) {
    deps.onCacheWriteFailed?.(filePath, error)
  }
  return imageResponse(bytes, format.contentType)
}
