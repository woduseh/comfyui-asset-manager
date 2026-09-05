import * as fs from 'fs'
import * as path from 'path'
import { MAX_IMPORT_FILE_SIZE_BYTES } from '../../constants'
import { isJsonObject, safeJsonParse } from '@shared/safe-json'

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

function isPromptVariantsRecord(
  value: unknown
): value is Record<string, { prompt: string; negative: string }> {
  return (
    isJsonObject(value) &&
    Object.values(value).every(
      (entry) =>
        isJsonObject(entry) &&
        typeof entry.prompt === 'string' &&
        typeof entry.negative === 'string'
    )
  )
}

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

  const parsedResult = safeJsonParse<unknown[]>(content, {
    context: 'JSON import content',
    validate: Array.isArray,
    invalidShapeMessage: 'JSON must be an array of objects'
  })

  if (!parsedResult.ok) {
    const error = parsedResult.error.startsWith('JSON import content is not valid JSON:')
      ? `Invalid JSON: ${parsedResult.error.replace('JSON import content is not valid JSON: ', '')}`
      : parsedResult.error

    return { items: [], format: 'json', errors: [{ line: 1, error }] }
  }

  const parsed = parsedResult.value

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

    if (obj.negative !== undefined && typeof obj.negative !== 'string') {
      errors.push({ line: i + 1, error: `Item ${i}: negative must be a string` })
      continue
    }
    if (typeof obj.negative === 'string') {
      item.negative = obj.negative.trim()
    }

    if (obj.prompt_variants !== undefined) {
      if (!isPromptVariantsRecord(obj.prompt_variants)) {
        errors.push({ line: i + 1, error: `Item ${i}: invalid prompt_variants` })
        continue
      }
      item.prompt_variants = obj.prompt_variants
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
  let headers: string[]
  try {
    headers = parseCSVLine(headerLine).map((h) => h.trim().toLowerCase())
    if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV header columns')
  } catch (error) {
    return {
      items: [],
      format: 'csv',
      errors: [{ line: 1, error: error instanceof Error ? error.message : String(error) }]
    }
  }

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
    let fields: string[]
    try {
      fields = parseCSVLine(lines[i])
      if (fields.length !== headers.length)
        throw new Error(`CSV row has ${fields.length} fields; expected ${headers.length}`)
    } catch (error) {
      errors.push({ line: lineNum, error: error instanceof Error ? error.message : String(error) })
      continue
    }

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

    if (negativeIdx !== -1) {
      item.negative = (fields[negativeIdx] ?? '').trim()
    }

    if (variantsIdx !== -1 && fields[variantsIdx]) {
      const variantsResult = safeJsonParse<Record<string, { prompt: string; negative: string }>>(
        fields[variantsIdx],
        {
          context: 'prompt_variants column',
          validate: isPromptVariantsRecord,
          invalidShapeMessage: 'prompt_variants column must contain a JSON object'
        }
      )

      if (variantsResult.ok) {
        item.prompt_variants = variantsResult.value
      } else {
        errors.push({ line: lineNum, error: variantsResult.error })
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
  let closedQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
          closedQuote = true
        }
      } else {
        current += ch
      }
    } else {
      if (closedQuote && ch !== ',' && !/\s/.test(ch))
        throw new Error('Unexpected text after CSV closing quote')
      if (closedQuote && /\s/.test(ch)) continue
      if (ch === '"') {
        if (current.trim()) throw new Error('Unexpected quote in unquoted CSV field')
        current = ''
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
        closedQuote = false
      } else {
        current += ch
      }
    }
  }
  if (inQuotes) throw new Error('Unclosed CSV quoted field; multiline fields are not supported')
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

  if (items.length === 0 && errors.length === 0) {
    errors.push({
      line: 1,
      error: 'Markdown must contain at least one ## item heading with a prompt'
    })
  }
  return { items, format: 'md', errors }
}

export function parseModuleItemsFile(filePath: string, format?: FileFormat): ParseResult {
  const resolved = path.resolve(filePath)

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

  return parseModuleItemsContent(content, detectedFormat)
}

/** Parse imported content in the selected format. */
export function parseModuleItemsContent(content: string, format: FileFormat): ParseResult {
  let result: ParseResult
  switch (format) {
    case 'json':
      result = parseJSON(content)
      break
    case 'csv':
      result = parseCSV(content)
      break
    case 'md':
      result = parseMarkdown(content)
      break
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
  const names = new Set<string>()
  for (const [index, item] of result.items.entries()) {
    const name = item.name.trim().toLowerCase()
    if (names.has(name)) {
      result.errors.push({ line: index + 1, error: `Duplicate item name: ${item.name}` })
    }
    names.add(name)
  }
  return result
}
