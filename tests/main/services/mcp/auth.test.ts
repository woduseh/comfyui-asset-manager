import { describe, expect, it } from 'vitest'
import {
  createMcpAuthToken,
  getOrCreateMcpAuthConfig,
  isMcpRequestAuthorized,
  isValidMcpAuthToken,
  rotateMcpAuthToken,
  setMcpAuthRequired
} from '@main/services/mcp/auth'

class MemorySettings {
  private values = new Map<string, string>()

  get(key: string): string | null {
    return this.values.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('MCP authentication', () => {
  it('creates and persists a valid 256-bit token with authentication enabled by default', () => {
    const settings = new MemorySettings()

    const first = getOrCreateMcpAuthConfig(settings)
    const second = getOrCreateMcpAuthConfig(settings)

    expect(first.required).toBe(true)
    expect(first.token).toHaveLength(64)
    expect(isValidMcpAuthToken(first.token)).toBe(true)
    expect(second).toEqual(first)
  })

  it('updates the required flag without replacing the token', () => {
    const settings = new MemorySettings()
    const initial = getOrCreateMcpAuthConfig(settings)

    const disabled = setMcpAuthRequired(false, settings)

    expect(disabled).toEqual({ required: false, token: initial.token })
  })

  it('rotates the token while preserving the required flag', () => {
    const settings = new MemorySettings()
    const initial = getOrCreateMcpAuthConfig(settings)

    const rotated = rotateMcpAuthToken(settings)

    expect(rotated.required).toBe(true)
    expect(rotated.token).not.toBe(initial.token)
    expect(isValidMcpAuthToken(rotated.token)).toBe(true)
  })

  it('accepts only an exact bearer token when authentication is required', () => {
    const token = createMcpAuthToken()
    const auth = { required: true, token }

    expect(isMcpRequestAuthorized(`Bearer ${token}`, auth)).toBe(true)
    expect(isMcpRequestAuthorized(`Bearer ${token.slice(1)}`, auth)).toBe(false)
    expect(isMcpRequestAuthorized(`Bearer ${'f'.repeat(64)}`, auth)).toBe(false)
    expect(isMcpRequestAuthorized(`Bearer ${'가'.repeat(64)}`, auth)).toBe(false)
    expect(isMcpRequestAuthorized(undefined, auth)).toBe(false)
    expect(isMcpRequestAuthorized(['Bearer token'], auth)).toBe(false)
    expect(isMcpRequestAuthorized(undefined, { ...auth, required: false })).toBe(true)
  })
})
