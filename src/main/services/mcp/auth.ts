import { randomBytes, timingSafeEqual } from 'crypto'
import { MCP_AUTH_TOKEN_BYTES } from '../../constants'
import { SettingsRepository } from '../database/repositories'

export const MCP_AUTH_TOKEN_SETTING = 'mcp_auth_token'
export const MCP_AUTH_REQUIRED_SETTING = 'mcp_auth_required'

const TOKEN_HEX_LENGTH = MCP_AUTH_TOKEN_BYTES * 2
const TOKEN_PATTERN = new RegExp(`^[a-f0-9]{${TOKEN_HEX_LENGTH}}$`)

export interface McpAuthConfig {
  required: boolean
  token: string
}

interface McpAuthSettings {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function createMcpAuthToken(): string {
  return randomBytes(MCP_AUTH_TOKEN_BYTES).toString('hex')
}

export function isValidMcpAuthToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

export function getOrCreateMcpAuthConfig(
  settings: McpAuthSettings = new SettingsRepository()
): McpAuthConfig {
  const required = settings.get(MCP_AUTH_REQUIRED_SETTING) !== 'false'
  let token = settings.get(MCP_AUTH_TOKEN_SETTING) ?? ''
  if (!isValidMcpAuthToken(token)) {
    token = createMcpAuthToken()
    settings.set(MCP_AUTH_TOKEN_SETTING, token)
  }
  return { required, token }
}

export function setMcpAuthRequired(
  required: boolean,
  settings: McpAuthSettings = new SettingsRepository()
): McpAuthConfig {
  settings.set(MCP_AUTH_REQUIRED_SETTING, required ? 'true' : 'false')
  return getOrCreateMcpAuthConfig(settings)
}

export function rotateMcpAuthToken(
  settings: McpAuthSettings = new SettingsRepository()
): McpAuthConfig {
  settings.set(MCP_AUTH_TOKEN_SETTING, createMcpAuthToken())
  return getOrCreateMcpAuthConfig(settings)
}

export function isMcpRequestAuthorized(
  authorizationHeader: string | string[] | undefined,
  auth: McpAuthConfig
): boolean {
  if (!auth.required) return true
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return false
  }

  const providedToken = authorizationHeader.slice('Bearer '.length)
  const providedBuffer = Buffer.from(providedToken)
  const expectedBuffer = Buffer.from(auth.token)
  if (providedBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(providedBuffer, expectedBuffer)
}
