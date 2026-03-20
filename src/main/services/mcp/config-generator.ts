import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MCP_SERVER_NAME = 'comfyui-asset-manager'

interface McpJsonConfig {
  mcpServers: Record<string, { type?: string; url?: string; command?: string; args?: string[] }>
}

/**
 * Writes or merges our MCP server entry into a `.mcp.json` file.
 * This is compatible with Claude Code and other MCP-aware CLIs.
 */
export function writeMcpJsonConfig(url: string, targetDir?: string): string {
  const dir = targetDir || homedir()
  const filePath = join(dir, '.mcp.json')

  let config: McpJsonConfig = { mcpServers: {} }

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      config = JSON.parse(raw)
      if (!config.mcpServers) config.mcpServers = {}
    } catch {
      // If corrupted, start fresh
      config = { mcpServers: {} }
    }
  }

  config.mcpServers[MCP_SERVER_NAME] = {
    type: 'url',
    url
  }

  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
  return filePath
}

/**
 * Removes our MCP server entry from a `.mcp.json` file.
 */
export function removeMcpJsonConfig(targetDir?: string): boolean {
  const dir = targetDir || homedir()
  const filePath = join(dir, '.mcp.json')

  if (!existsSync(filePath)) return false

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const config: McpJsonConfig = JSON.parse(raw)

    if (config.mcpServers && config.mcpServers[MCP_SERVER_NAME]) {
      delete config.mcpServers[MCP_SERVER_NAME]
      writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
      return true
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * Checks whether each supported CLI has been configured for MCP.
 */
export function getMcpConfigStatus(): { claudeCode: boolean; configPath: string } {
  const configPath = join(homedir(), '.mcp.json')
  let claudeCode = false

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config: McpJsonConfig = JSON.parse(raw)
      claudeCode = !!(config.mcpServers && config.mcpServers[MCP_SERVER_NAME])
    } catch {
      // ignore
    }
  }

  return { claudeCode, configPath }
}
