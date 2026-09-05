import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import log from '../../logger'
import { safeJsonParse } from '@shared/safe-json'

const MCP_SERVER_NAME = 'comfyui-asset-manager'
const TOML_SECTION_HEADER = `[mcp_servers."${MCP_SERVER_NAME}"]`

function logConfigDebug(context: string, error: unknown): void {
  log.debug(`[MCP] ${context}:`, error)
}

interface McpJsonConfig {
  mcpServers: Record<
    string,
    {
      type?: string
      url?: string
      httpUrl?: string
      command?: string
      args?: string[]
      tools?: string[]
      headers?: Record<string, string>
    }
  >
}

interface GeminiSettings {
  mcpServers?: McpJsonConfig['mcpServers']
  [key: string]: unknown
}

interface McpClientAuthReadiness {
  claudeCode: boolean
  copilotCli: boolean
  geminiCli: boolean
  codexCli: boolean
}

function getAuthorizationHeaders(token?: string): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

function hasCurrentAuthorization(
  entry: McpJsonConfig['mcpServers'][string] | undefined,
  token: string | undefined,
  authRequired: boolean
): boolean {
  if (!authRequired) return true
  return Boolean(token && entry?.headers?.Authorization === `Bearer ${token}`)
}

export function parseJsonConfigText<T = unknown>(raw: string, context: string): T | null {
  const parsed = safeJsonParse<T>(raw, { context })
  if (!parsed.ok) {
    log.warn(`[MCP] ${parsed.error}`)
    return null
  }

  return parsed.value
}

/**
 * Writes or merges our MCP server entry into a `.mcp.json` file
 * (Claude Code and other standard MCP clients).
 */
function writeDotMcpJson(url: string, token: string | undefined, homeDir: string): string {
  const dir = homeDir
  const filePath = join(dir, '.mcp.json')

  let config: McpJsonConfig = { mcpServers: {} }

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = parseJsonConfigText<McpJsonConfig>(raw, '.mcp.json config')
      if (parsed) {
        config = parsed
        if (!config.mcpServers) config.mcpServers = {}
      }
    } catch (error) {
      logConfigDebug(
        'Failed to read existing .mcp.json config, falling back to a new config',
        error
      )
      config = { mcpServers: {} }
    }
  }

  config.mcpServers[MCP_SERVER_NAME] = {
    type: 'http',
    url,
    headers: getAuthorizationHeaders(token)
  }

  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
  return filePath
}

/**
 * Writes our MCP server entry into Gemini CLI settings.
 * Gemini CLI reads streamable HTTP servers from `~/.gemini/settings.json` via `httpUrl`.
 */
function writeGeminiConfig(url: string, token: string | undefined, homeDir: string): string | null {
  const geminiDir = join(homeDir, '.gemini')
  const filePath = join(geminiDir, 'settings.json')

  try {
    if (!existsSync(geminiDir)) {
      // Only write if .gemini dir already exists (Gemini CLI is installed)
      return null
    }

    let settings: GeminiSettings = {}

    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const parsed = parseJsonConfigText<GeminiSettings>(raw, 'Gemini settings')
        if (!parsed) {
          return null
        }
        settings = parsed
      } catch (error) {
        logConfigDebug('Failed to read existing Gemini settings, leaving them untouched', error)
        // Don't overwrite corrupted settings
        return null
      }
    }

    if (!settings.mcpServers) settings.mcpServers = {}
    settings.mcpServers[MCP_SERVER_NAME] = {
      httpUrl: url,
      headers: getAuthorizationHeaders(token)
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
    return filePath
  } catch (error) {
    logConfigDebug('Failed to write Gemini CLI config', error)
    return null
  }
}

/**
 * Writes our MCP server entry into GitHub Copilot CLI config.
 * Copilot CLI reads from `~/.copilot/mcp-config.json` with `type: "http"`.
 */
function writeCopilotCliConfig(
  url: string,
  token: string | undefined,
  homeDir: string
): string | null {
  const copilotDir = join(homeDir, '.copilot')
  const filePath = join(copilotDir, 'mcp-config.json')

  try {
    if (!existsSync(copilotDir)) {
      return null
    }

    let config: McpJsonConfig = { mcpServers: {} }

    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const parsed = parseJsonConfigText<McpJsonConfig>(raw, 'Copilot CLI MCP config')
        if (!parsed) {
          return null
        }
        config = parsed
        if (!config.mcpServers) config.mcpServers = {}
      } catch (error) {
        logConfigDebug('Failed to read existing Copilot CLI config, leaving it untouched', error)
        // Don't overwrite corrupted config
        return null
      }
    }

    config.mcpServers[MCP_SERVER_NAME] = {
      type: 'http',
      url,
      tools: ['*'],
      headers: getAuthorizationHeaders(token)
    }

    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
    return filePath
  } catch (error) {
    logConfigDebug('Failed to write Copilot CLI config', error)
    return null
  }
}

/**
 * Writes MCP server config for all supported CLIs.
 */
export function writeMcpJsonConfig(
  url: string,
  token?: string,
  homeDir: string = homedir()
): string {
  const mcpJsonPath = writeDotMcpJson(url, token, homeDir)

  // Also configure Gemini CLI if installed
  const geminiPath = writeGeminiConfig(url, token, homeDir)
  if (geminiPath) {
    log.info(`[MCP] Gemini CLI config written to ${geminiPath}`)
  }

  // Also configure Copilot CLI if installed
  const copilotPath = writeCopilotCliConfig(url, token, homeDir)
  if (copilotPath) {
    log.info(`[MCP] Copilot CLI config written to ${copilotPath}`)
  }

  return mcpJsonPath
}

/**
 * Removes our MCP server entry from all config files.
 */
export function removeMcpJsonConfig(homeDir: string = homedir()): boolean {
  let removed = false

  // Remove from .mcp.json
  const dir = homeDir
  const mcpJsonPath = join(dir, '.mcp.json')
  if (existsSync(mcpJsonPath)) {
    try {
      const raw = readFileSync(mcpJsonPath, 'utf-8')
      const config = parseJsonConfigText<McpJsonConfig>(raw, '.mcp.json config')
      if (!config) {
        return removed
      }
      if (config.mcpServers && config.mcpServers[MCP_SERVER_NAME]) {
        delete config.mcpServers[MCP_SERVER_NAME]
        writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf-8')
        removed = true
      }
    } catch (error) {
      logConfigDebug('Failed to remove MCP entry from .mcp.json', error)
    }
  }

  // Remove from Gemini CLI settings
  const geminiPath = join(homeDir, '.gemini', 'settings.json')
  if (existsSync(geminiPath)) {
    try {
      const raw = readFileSync(geminiPath, 'utf-8')
      const settings = parseJsonConfigText<GeminiSettings>(raw, 'Gemini settings')
      if (!settings) {
        return removed
      }
      if (settings.mcpServers && settings.mcpServers[MCP_SERVER_NAME]) {
        delete settings.mcpServers[MCP_SERVER_NAME]
        writeFileSync(geminiPath, JSON.stringify(settings, null, 2), 'utf-8')
        removed = true
      }
    } catch (error) {
      logConfigDebug('Failed to remove MCP entry from Gemini settings', error)
    }
  }

  // Remove from Copilot CLI config
  const copilotConfigPath = join(homeDir, '.copilot', 'mcp-config.json')
  if (existsSync(copilotConfigPath)) {
    try {
      const raw = readFileSync(copilotConfigPath, 'utf-8')
      const config = parseJsonConfigText<McpJsonConfig>(raw, 'Copilot CLI MCP config')
      if (!config) {
        return removed
      }
      if (config.mcpServers && config.mcpServers[MCP_SERVER_NAME]) {
        delete config.mcpServers[MCP_SERVER_NAME]
        writeFileSync(copilotConfigPath, JSON.stringify(config, null, 2), 'utf-8')
        removed = true
      }
    } catch (error) {
      logConfigDebug('Failed to remove MCP entry from Copilot CLI config', error)
    }
  }

  return removed
}

/**
 * Checks whether each supported CLI has been configured for MCP.
 */
export function getMcpConfigStatus(
  token?: string,
  authRequired = true,
  homeDir: string = homedir()
): {
  claudeCode: boolean
  copilotCli: boolean
  geminiCli: boolean
  codexCli: boolean
  authReady: McpClientAuthReadiness
  configPath: string
} {
  const configPath = join(homeDir, '.mcp.json')
  let claudeCode = false
  let copilotCli = false
  let geminiCli = false
  let codexCli = false
  const authReady: McpClientAuthReadiness = {
    claudeCode: !authRequired,
    copilotCli: !authRequired,
    geminiCli: !authRequired,
    codexCli: !authRequired
  }

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config = parseJsonConfigText<McpJsonConfig>(raw, '.mcp.json config')
      claudeCode = !!(config && config.mcpServers && config.mcpServers[MCP_SERVER_NAME])
      authReady.claudeCode = hasCurrentAuthorization(
        config?.mcpServers?.[MCP_SERVER_NAME],
        token,
        authRequired
      )
    } catch (error) {
      logConfigDebug('Failed to inspect .mcp.json MCP status', error)
    }
  }

  const copilotConfigPath = join(homeDir, '.copilot', 'mcp-config.json')
  if (existsSync(copilotConfigPath)) {
    try {
      const raw = readFileSync(copilotConfigPath, 'utf-8')
      const config = parseJsonConfigText<McpJsonConfig>(raw, 'Copilot CLI MCP config')
      copilotCli = !!(config && config.mcpServers && config.mcpServers[MCP_SERVER_NAME])
      authReady.copilotCli = hasCurrentAuthorization(
        config?.mcpServers?.[MCP_SERVER_NAME],
        token,
        authRequired
      )
    } catch (error) {
      logConfigDebug('Failed to inspect Copilot CLI MCP status', error)
    }
  }

  const geminiPath = join(homeDir, '.gemini', 'settings.json')
  if (existsSync(geminiPath)) {
    try {
      const raw = readFileSync(geminiPath, 'utf-8')
      const settings = parseJsonConfigText<GeminiSettings>(raw, 'Gemini settings')
      geminiCli = !!(settings && settings.mcpServers && settings.mcpServers[MCP_SERVER_NAME])
      authReady.geminiCli = hasCurrentAuthorization(
        settings?.mcpServers?.[MCP_SERVER_NAME],
        token,
        authRequired
      )
    } catch (error) {
      logConfigDebug('Failed to inspect Gemini CLI MCP status', error)
    }
  }

  const codexPath = join(homeDir, '.codex', 'config.toml')
  if (existsSync(codexPath)) {
    try {
      const content = readFileSync(codexPath, 'utf-8')
      codexCli = content.includes(TOML_SECTION_HEADER)
      authReady.codexCli =
        !authRequired ||
        (codexCli && content.includes('bearer_token_env_var = "COMFYUI_ASSET_MANAGER_MCP_TOKEN"'))
    } catch (error) {
      logConfigDebug('Failed to inspect Codex CLI MCP status', error)
    }
  }

  return { claudeCode, copilotCli, geminiCli, codexCli, authReady, configPath }
}
