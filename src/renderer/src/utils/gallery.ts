import { isJsonObject, safeJsonParse } from '@shared/safe-json'

export function toAssetUrl(path: string | null | undefined): string {
  return path ? 'local-asset://image/' + encodeURIComponent(path) : ''
}

export function toThumbnailUrl(image: {
  file_path: string
  thumbnail_path: string | null
}): string {
  return 'local-asset://thumbnail/' + encodeURIComponent(image.thumbnail_path || image.file_path)
}

export function formatGalleryFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function parseGalleryGenerationParams(json: string | null): Record<string, unknown> | null {
  if (!json) return null
  const parsed = safeJsonParse<Record<string, unknown>>(json, {
    context: 'Generation params',
    validate: isJsonObject,
    invalidShapeMessage: 'Generation params must be an object'
  })
  return parsed.ok ? parsed.value : null
}
