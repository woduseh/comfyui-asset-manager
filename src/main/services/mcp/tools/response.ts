import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function jsonResult(value: unknown): CallToolResult {
  const structuredContent =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { items: value }
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent }
}

export function jsonError(message: string): CallToolResult {
  return { ...jsonResult({ error: message }), isError: true }
}
