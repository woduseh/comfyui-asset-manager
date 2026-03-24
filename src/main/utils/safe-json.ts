export interface SafeJsonParseOptions<T> {
  context?: string
  validate?: (value: unknown) => value is T
  invalidShapeMessage?: string
}

export type SafeJsonParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function safeJsonParse<T = unknown>(
  input: string | null | undefined,
  options: SafeJsonParseOptions<T> = {}
): SafeJsonParseResult<T> {
  const context = options.context || 'JSON input'

  if (input == null) {
    return { ok: false, error: `${context} is missing` }
  }

  if (input.trim() === '') {
    return { ok: false, error: `${context} is empty` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `${context} is not valid JSON: ${message}` }
  }

  if (options.validate && !options.validate(parsed)) {
    return {
      ok: false,
      error: options.invalidShapeMessage || `${context} has an invalid shape`
    }
  }

  return { ok: true, value: parsed as T }
}
