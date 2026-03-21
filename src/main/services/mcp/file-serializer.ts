import * as fs from 'fs'
import * as path from 'path'
import log from '../../logger'
import type { ParsedModuleItem } from './file-parser'

export type SerializeFormat = 'json' | 'csv' | 'md'

/** Serialize module items to string in the specified format */
export function serializeModuleItems(items: ParsedModuleItem[], format: SerializeFormat): string {
  switch (format) {
    case 'json':
      return serializeJSON(items)
    case 'csv':
      return serializeCSV(items)
    case 'md':
      return serializeMarkdown(items)
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}

function serializeJSON(items: ParsedModuleItem[]): string {
  const cleaned = items.map((item) => {
    const obj: Record<string, unknown> = {
      name: item.name,
      prompt: item.prompt
    }
    if (item.negative) obj.negative = item.negative
    if (item.prompt_variants && Object.keys(item.prompt_variants).length > 0) {
      obj.prompt_variants = item.prompt_variants
    }
    return obj
  })
  return JSON.stringify(cleaned, null, 2)
}

function serializeCSV(items: ParsedModuleItem[]): string {
  const hasNegative = items.some((i) => i.negative)
  const hasVariants = items.some(
    (i) => i.prompt_variants && Object.keys(i.prompt_variants).length > 0
  )

  const headers = ['name', 'prompt']
  if (hasNegative) headers.push('negative')
  if (hasVariants) headers.push('prompt_variants')

  const lines = [headers.join(',')]

  for (const item of items) {
    const fields: string[] = [escapeCSVField(item.name), escapeCSVField(item.prompt)]
    if (hasNegative) fields.push(escapeCSVField(item.negative || ''))
    if (hasVariants) {
      fields.push(
        escapeCSVField(
          item.prompt_variants && Object.keys(item.prompt_variants).length > 0
            ? JSON.stringify(item.prompt_variants)
            : ''
        )
      )
    }
    lines.push(fields.join(','))
  }

  return lines.join('\n')
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function serializeMarkdown(items: ParsedModuleItem[]): string {
  const sections: string[] = []

  for (const item of items) {
    let section = `## ${item.name}\n${item.prompt}`
    if (item.negative) {
      section += `\n### Negative\n${item.negative}`
    }
    sections.push(section)
  }

  return sections.join('\n\n')
}

/** Detect format from file extension */
function detectFormat(filePath: string): SerializeFormat {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.json':
      return 'json'
    case '.csv':
    case '.tsv':
      return 'csv'
    case '.md':
    case '.markdown':
      return 'md'
    default:
      throw new Error(`Cannot detect format from extension "${ext}". Specify format explicitly.`)
  }
}

/** Write module items to a file. Refuses to overwrite existing files. */
export function writeModuleItemsFile(
  items: ParsedModuleItem[],
  filePath: string,
  format?: SerializeFormat
): { filePath: string; format: SerializeFormat; size: number } {
  const resolved = path.resolve(filePath)
  const normalized = path.normalize(resolved)
  if (normalized !== resolved) {
    log.warn(`Path traversal attempt blocked: ${filePath}`)
    throw new Error('Invalid file path')
  }

  const dir = path.dirname(resolved)
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`)
  }

  if (fs.existsSync(resolved)) {
    throw new Error(`File already exists: ${resolved}. Remove it first or choose a different path.`)
  }

  const detectedFormat = format || detectFormat(resolved)
  const content = serializeModuleItems(items, detectedFormat)
  fs.writeFileSync(resolved, content, 'utf-8')

  const stats = fs.statSync(resolved)
  return { filePath: resolved, format: detectedFormat, size: stats.size }
}
