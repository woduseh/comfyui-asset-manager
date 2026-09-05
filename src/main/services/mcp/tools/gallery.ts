import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { nativeImage } from 'electron'
import { statSync } from 'fs'
import { z } from 'zod'
import { isJsonObject, safeJsonParse } from '@shared/safe-json'
import { resolveDirectAssetPathFromSettings } from '../../assets/local-asset'
import { flushDatabase, withTransaction } from '../../database'
import { GeneratedImageRepository, SettingsRepository } from '../../database/repositories'
import { jsonError, jsonResult } from './response'

const imageRepo = new GeneratedImageRepository()
const settingsRepo = new SettingsRepository()
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

function getImage(id: string): Record<string, unknown> | null {
  return imageRepo.get(id)
}

function imageSummary(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    job_id: row.job_id,
    task_id: row.task_id,
    width: row.width,
    height: row.height,
    rating: row.rating,
    favorite: row.is_favorite === 1,
    character_name: row.character_name,
    outfit_name: row.outfit_name,
    emotion_name: row.emotion_name,
    style_name: row.style_name,
    created_at: row.created_at
  }
}

export function registerGalleryTools(server: McpServer): void {
  server.tool(
    'list_generated_images',
    'List generated image summaries for visual review. Filter by job_id, rating, favorite, or exact character/outfit/emotion/style names. Use get_generated_image for prompts and a viewable preview. Results are paginated; no image files are changed.',
    {
      job_id: z.string().min(1).optional(),
      min_rating: z.number().int().min(0).max(5).optional(),
      favorite: z.boolean().optional(),
      character_name: z.string().min(1).optional(),
      outfit_name: z.string().min(1).optional(),
      emotion_name: z.string().min(1).optional(),
      style_name: z.string().min(1).optional(),
      page: z.number().int().min(1).max(1000000).optional().default(1),
      page_size: z.number().int().min(1).max(100).optional().default(20),
      sort_by: z.enum(['created_at', 'rating', 'file_size']).optional().default('created_at'),
      sort_order: z.enum(['asc', 'desc']).optional().default('desc')
    },
    async (args) => {
      const result = imageRepo.list({
        jobId: args.job_id,
        minRating: args.min_rating,
        isFavorite: args.favorite,
        characterName: args.character_name,
        outfitName: args.outfit_name,
        emotionName: args.emotion_name,
        styleName: args.style_name,
        page: args.page,
        pageSize: args.page_size,
        sortBy: args.sort_by,
        sortOrder: args.sort_order
      })
      return jsonResult({
        items: result.items.map(imageSummary),
        total: result.total,
        page: args.page,
        page_size: args.page_size,
        has_more: args.page * args.page_size < result.total
      })
    }
  )

  server.tool(
    'get_generated_image',
    'Get a generated image by its gallery ID, including prompts, generation parameters, review status, and an actual JPEG image preview. Preview longest side is at most 1024 pixels and encoded size at most 2 MiB. Set include_image=false for metadata only. No arbitrary file paths are accepted.',
    {
      id: z.string().min(1).describe('Generated image gallery ID'),
      include_image: z.boolean().optional().default(true)
    },
    async ({ id, include_image }) => {
      const row = getImage(id)
      if (!row) return jsonError(`Generated image not found: ${id}`)
      const parsed = safeJsonParse(row.generation_params as string, { validate: isJsonObject })
      const metadata = {
        ...imageSummary(row),
        file_path: row.file_path,
        file_size: row.file_size,
        prompt: row.prompt_text,
        negative: row.negative_text,
        generation_params: parsed.ok ? parsed.value : null,
        ...(parsed.ok ? {} : { generation_params_error: parsed.error })
      }
      if (!include_image) return jsonResult(metadata)

      try {
        const allowedPath = resolveDirectAssetPathFromSettings(row.file_path as string, {
          settings: settingsRepo,
          resolverDeps: {
            // A registered symlink must not authorize an unregistered real target outside the root.
            isTrackedAssetPath: (paths) => imageRepo.hasTrackedAssetPath(paths.slice(-1))
          }
        })
        if (!allowedPath) throw new Error('Image path is outside the allowed asset boundary')
        const stats = statSync(allowedPath)
        if (!stats.isFile() || stats.size > MAX_SOURCE_BYTES) {
          throw new Error('Image must be a regular file no larger than 64 MiB')
        }
        const original = nativeImage.createFromPath(allowedPath)
        if (original.isEmpty()) throw new Error('Image file could not be decoded')
        const size = original.getSize()
        if (size.width <= 0 || size.height <= 0) throw new Error('Image dimensions are invalid')
        const scale = Math.min(1, 1024 / Math.max(size.width, size.height))
        const preview = original.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good'
        })
        const bytes = preview.toJPEG(80)
        if (bytes.length > MAX_PREVIEW_BYTES) throw new Error('Encoded image preview exceeds 2 MiB')
        const result = jsonResult({
          ...metadata,
          preview: { ...preview.getSize(), mime_type: 'image/jpeg' }
        })
        result.content.push({
          type: 'image',
          data: bytes.toString('base64'),
          mimeType: 'image/jpeg'
        })
        return result
      } catch (error) {
        return {
          ...jsonResult({
            ...metadata,
            preview_error: error instanceof Error ? error.message : String(error)
          }),
          isError: true
        }
      }
    }
  )

  server.tool(
    'review_generated_image',
    'Save an image rating (0 means unrated, 1-5 stars) and/or favorite status by gallery ID. At least one review field is required. Returns success only after the database is persisted. This changes gallery metadata only and never deletes or changes image files.',
    {
      id: z.string().min(1),
      rating: z.number().int().min(0).max(5).optional(),
      favorite: z.boolean().optional()
    },
    async ({ id, rating, favorite }) => {
      if (rating === undefined && favorite === undefined)
        return jsonError('Provide rating or favorite')
      if (!getImage(id)) return jsonError(`Generated image not found: ${id}`)
      try {
        withTransaction(() => {
          if (rating !== undefined) imageRepo.updateRating(id, rating)
          if (favorite !== undefined) imageRepo.updateFavorite(id, favorite)
        })
        const updated = getImage(id)
        if (!updated) throw new Error('Generated image disappeared during review')
        const summary = imageSummary(updated)
        await flushDatabase()
        return jsonResult({ success: true, image: summary })
      } catch (error) {
        return jsonError(
          `Image review was not confirmed persisted: ${error instanceof Error ? error.message : String(error)}. Retry the same review values to confirm persistence.`
        )
      }
    }
  )
}
