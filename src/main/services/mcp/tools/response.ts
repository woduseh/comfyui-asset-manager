import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export function jsonError(message: string): CallToolResult {
  return { ...jsonResult({ error: message }), isError: true }
}
