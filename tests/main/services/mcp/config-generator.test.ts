import { describe, expect, it } from 'vitest'
import { parseJsonConfigText } from '../../../../src/main/services/mcp/config-generator'

describe('parseJsonConfigText', () => {
  it('returns parsed JSON for valid text', () => {
    expect(parseJsonConfigText('{"mcpServers":{}}', 'test config')).toEqual({ mcpServers: {} })
  })

  it('returns null for invalid JSON text', () => {
    expect(parseJsonConfigText('{', 'broken config')).toBeNull()
  })
})
