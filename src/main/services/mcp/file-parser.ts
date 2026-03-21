import * as fs from 'fs'
import * as path from 'path'
import log from '../../logger'
import { MAX_IMPORT_FILE_SIZE_BYTES } from '../../constants'

export interface ParsedModuleItem {
  name: string
  prompt: string
  negative?: string
  prompt_variants?: Record<string, { prompt: string; negative: string }>
}

export interface ParseResult {
  items: ParsedModuleItem[]
  format: 'json' | 'csv' | 'md'
  errors: Array<{ line: number; error: string }>
}

type FileFormat = 'json' | 'csv' | 'md'

function detectFormat(filePath: string): FileFormat {
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

function parseJSON(content: string): ParseResult {
  const errors: Array<{ line: number; error: string }> = []
  const items: ParsedModuleItem[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { items: [], format: 'json', errors: [{ line: 1, error: `Invalid JSON: ${msg}` }] }
  }

  if (!Array.isArray(parsed)) {
    return {
      items: [],
      format: 'json',
      errors: [{ line: 1, error: 'JSON must be an array of objects' }]
    }
  }

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i]
    if (!entry || typeof entry !== 'object') {
      errors.push({ line: i + 1, error: `Item ${i}: not an object` })
      continue
    }

    const obj = entry as Record<string, unknown>
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      errors.push({ line: i + 1, error: `Item ${i}: missing or empty "name"` })
      continue
    }
    if (typeof obj.prompt !== 'string' || !obj.prompt.trim()) {
      errors.push({ line: i + 1, error: `Item ${i}: missing or empty "prompt"` })
      continue
    }

    const item: ParsedModuleItem = {
      name: obj.name.trim(),
      prompt: obj.prompt.trim()
    }

    if (typeof obj.negative === 'string') {
      item.negative = obj.negative.trim()
    }

    if (obj.prompt_variants && typeof obj.prompt_variants === 'object') {
      item.prompt_variants = obj.prompt_variants as Record<
        string,
        { prompt: string; negative: string }
      >
    }

    items.push(item)
  }

  return { items, format: 'json', errors }
}

function parseCSV(content: string): ParseResult {
  const errors: Array<{ line: number; error: string }> = []
  const items: ParsedModuleItem[] = []
  const lines = content.split(/\r?\n/).filter((l) => l.trim())

  if (lines.length < 2) {
    return { items: [], format: 'csv', errors: [{ line: 1, error: 'CSV must have header + data' }] }
  }

  const headerLine = lines[0]
  const headers = parseCSVLine(headerLine).map((h) => h.trim().toLowerCase())

  const nameIdx = headers.indexOf('name')
  const promptIdx = headers.indexOf('prompt')
  const negativeIdx = headers.indexOf('negative')
  const variantsIdx = headers.indexOf('prompt_variants')

  if (nameIdx === -1 || promptIdx === -1) {
    return {
      items: [],
      format: 'csv',
      errors: [{ line: 1, error: 'CSV header must contain "name" and "prompt" columns' }]
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1
    const fields = parseCSVLine(lines[i])

    const name = fields[nameIdx]?.trim()
    const prompt = fields[promptIdx]?.trim()

    if (!name) {
      errors.push({ line: lineNum, error: 'Empty name' })
      continue
    }
    if (!prompt) {
      errors.push({ line: lineNum, error: 'Empty prompt' })
      continue
    }

    const item: ParsedModuleItem = { name, prompt }

    if (negativeIdx !== -1 && fields[negativeIdx]) {
      item.negative = fields[negativeIdx].trim()
    }

    if (variantsIdx !== -1 && fields[variantsIdx]) {
      try {
        const variants = JSON.parse(fields[variantsIdx])
        if (typeof variants === 'object' && variants !== null) {
          item.prompt_variants = variants
        }
      } catch {
        errors.push({ line: lineNum, error: 'Invalid JSON in prompt_variants column' })
      }
    }

    items.push(item)
  }

  return { items, format: 'csv', errors }
}

/** Simple RFC 4180-ish CSV line parser supporting quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

function parseMarkdown(content: string): ParseResult {
  const errors: Array<{ line: number; error: string }> = []
  const items: ParsedModuleItem[] = []
  const lines = content.split(/\r?\n/)

  let currentName = ''
  let currentPromptLines: string[] = []
  let currentNegativeLines: string[] = []
  let headerLineNum = 0
  let inNegative = false

  function flushItem(): void {
    if (!currentName) return
    const prompt = currentPromptLines.join(', ').trim()
    if (!prompt) {
      errors.push({ line: headerLineNum, error: `"${currentName}": empty prompt` })
    } else {
      const item: ParsedModuleItem = { name: currentName, prompt }
      const negative = currentNegativeLines.join(', ').trim()
      if (negative) item.negative = negative
      items.push(item)
    }
    currentName = ''
    currentPromptLines = []
    currentNegativeLines = []
    inNegative = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headerMatch = line.match(/^##\s+(.+)$/)

    if (headerMatch) {
      flushItem()
      currentName = headerMatch[1].trim()
      headerLineNum = i + 1
      inNegative = false
      continue
    }

    if (!currentName) continue

    // Check for negative section marker
    if (line.match(/^###\s*negative/i) || line.match(/^\*\*negative\*\*/i)) {
      inNegative = true
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) continue

    if (inNegative) {
      currentNegativeLines.push(trimmed)
    } else {
      currentPromptLines.push(trimmed)
    }
  }

  flushItem()

  return { items, format: 'md', errors }
}

export function parseModuleItemsFile(filePath: string, format?: FileFormat): ParseResult {
  // Validate path
  const resolved = path.resolve(filePath)
  if (!path.isAbsolute(resolved)) {
    throw new Error('File path must be absolute')
  }

  // Security: block path traversal
  const normalized = path.normalize(resolved)
  if (normalized !== resolved) {
    log.warn(`Path traversal attempt blocked: ${filePath}`)
    throw new Error('Invalid file path')
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`)
  }

  const stats = fs.statSync(resolved)
  if (!stats.isFile()) {
    throw new Error('Path is not a file')
  }
  if (stats.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large (${(stats.size / 1024).toFixed(1)}KB). Maximum: ${MAX_IMPORT_FILE_SIZE_BYTES / 1024}KB`
    )
  }

  const detectedFormat = format || detectFormat(resolved)
  const content = fs.readFileSync(resolved, 'utf-8')

  switch (detectedFormat) {
    case 'json':
      return parseJSON(content)
    case 'csv':
      return parseCSV(content)
    case 'md':
      return parseMarkdown(content)
    default:
      throw new Error(`Unsupported format: ${detectedFormat}`)
  }
}

/** Parse content directly without reading from file (for testing) */
export function parseModuleItemsContent(
  content: string,
  format: FileFormat
): Omit<ParseResult, 'format'> & { format: FileFormat } {
  switch (format) {
    case 'json':
      return parseJSON(content)
    case 'csv':
      return parseCSV(content)
    case 'md':
      return parseMarkdown(content)
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}
