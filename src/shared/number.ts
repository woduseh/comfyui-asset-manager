export function parseIntegerOrFallback(value: string | null | undefined, fallback: number): number {
  if (value == null || value.trim() === '') {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}
