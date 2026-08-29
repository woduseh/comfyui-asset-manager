const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}
