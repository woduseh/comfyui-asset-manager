import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import log from '../../logger'

const MCP_SERVER_NAME = 'comfyui-asset-manager'
const TOML_SECTION_HEADER = `[mcp_servers."${MCP_SERVER_NAME}"]`

interface McpJsonConfig {
  mcpServers: Record<string, { type?: string; url?: string; command?: string; args?: string[] }>
}

interface GeminiSettings {
  mcpServers?: Record<string, { type?: string; url?: string; command?: string; args?: string[] }>
  [key: string]: unknown
}

/**
 * Writes or merges our MCP server entry into a `.mcp.json` file
 * (Claude Code, Copilot CLI, and other standard MCP clients).
 */
function writeDotMcpJson(url: string, targetDir?: string): string {
  const dir = targetDir || homedir()
  const filePath = join(dir, '.mcp.json')

  let config: McpJsonConfig = { mcpServers: {} }

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      config = JSON.parse(raw)
      if (!config.mcpServers) config.mcpServers = {}
    } catch {
      config = { mcpServers: {} }
    }
  }

  config.mcpServers[MCP_SERVER_NAME] = { url }

  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
  return filePath
}

/**
 * Writes our MCP server entry into Gemini CLI settings.
 * Gemini CLI reads from `~/.gemini/settings.json` with `type: "http"`.
 */
function writeGeminiConfig(url: string): string | null {
  const geminiDir = join(homedir(), '.gemini')
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
        settings = JSON.parse(raw)
      } catch {
        // Don't overwrite corrupted settings
        return null
      }
    }

    if (!settings.mcpServers) settings.mcpServers = {}
    settings.mcpServers[MCP_SERVER_NAME] = { type: 'http', url }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
    return filePath
  } catch {
    return null
  }
}

/**
 * Writes our MCP server entry into OpenAI Codex config.
 * Codex reads from `~/.codex/config.toml` with `[mcp_servers.<name>]` sections.
 */
function writeCodexConfig(url: string): string | null {
  const codexDir = join(homedir(), '.codex')
  const filePath = join(codexDir, 'config.toml')

  try {
    if (!existsSync(codexDir)) {
      return null
    }

    let content = ''
    if (existsSync(filePath)) {
      content = readFileSync(filePath, 'utf-8')
    }

    const sectionBlock = `${TOML_SECTION_HEADER}\nurl = "${url}"\n`

    // Check if our section already exists
    const sectionRegex = new RegExp(
      `\\[mcp_servers\\."${MCP_SERVER_NAME}"\\][\\s\\S]*?(?=\\n\\[|$)`,
      'm'
    )

    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, sectionBlock.trimEnd())
    } else {
      const trimmed = content.trimEnd()
      content = trimmed ? `${trimmed}\n\n${sectionBlock}` : sectionBlock
    }

    writeFileSync(filePath, content, 'utf-8')
    return filePath
  } catch {
    return null
  }
}

/**
 * Writes MCP server config for all supported CLIs.
 */
export function writeMcpJsonConfig(url: string, targetDir?: string): string {
  const mcpJsonPath = writeDotMcpJson(url, targetDir)

  // Also configure Gemini CLI if installed
  const geminiPath = writeGeminiConfig(url)
  if (geminiPath) {
    log.info(`[MCP] Gemini CLI config written to ${geminiPath}`)
  }

  // Also configure Codex CLI if installed
  const codexPath = writeCodexConfig(url)
  if (codexPath) {
    log.info(`[MCP] Codex CLI config written to ${codexPath}`)
  }

  return mcpJsonPath
}

/**
 * Removes our MCP server entry from all config files.
 */
export function removeMcpJsonConfig(targetDir?: string): boolean {
  let removed = false

  // Remove from .mcp.json
  const dir = targetDir || homedir()
  const mcpJsonPath = join(dir, '.mcp.json')
  if (existsSync(mcpJsonPath)) {
    try {
      const raw = readFileSync(mcpJsonPath, 'utf-8')
      const config: McpJsonConfig = JSON.parse(raw)
      if (config.mcpServers && config.mcpServers[MCP_SERVER_NAME]) {
        delete config.mcpServers[MCP_SERVER_NAME]
        writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf-8')
        removed = true
      }
    } catch {
      /* ignore */
    }
  }

  // Remove from Gemini CLI settings
  const geminiPath = join(homedir(), '.gemini', 'settings.json')
  if (existsSync(geminiPath)) {
    try {
      const raw = readFileSync(geminiPath, 'utf-8')
      const settings: GeminiSettings = JSON.parse(raw)
      if (settings.mcpServers && settings.mcpServers[MCP_SERVER_NAME]) {
        delete settings.mcpServers[MCP_SERVER_NAME]
        writeFileSync(geminiPath, JSON.stringify(settings, null, 2), 'utf-8')
        removed = true
      }
    } catch {
      /* ignore */
    }
  }

  // Remove from Codex config.toml
  const codexPath = join(homedir(), '.codex', 'config.toml')
  if (existsSync(codexPath)) {
    try {
      let content = readFileSync(codexPath, 'utf-8')
      const sectionRegex = new RegExp(
        `\\n?\\[mcp_servers\\."${MCP_SERVER_NAME}"\\][\\s\\S]*?(?=\\n\\[|$)`,
        'm'
      )
      if (sectionRegex.test(content)) {
        content = content.replace(sectionRegex, '').trim()
        writeFileSync(codexPath, content ? content + '\n' : '', 'utf-8')
        removed = true
      }
    } catch {
      /* ignore */
    }
  }

  return removed
}

/**
 * Checks whether each supported CLI has been configured for MCP.
 */
export function getMcpConfigStatus(): {
  claudeCode: boolean
  geminiCli: boolean
  codexCli: boolean
  configPath: string
} {
  const configPath = join(homedir(), '.mcp.json')
  let claudeCode = false
  let geminiCli = false
  let codexCli = false

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config: McpJsonConfig = JSON.parse(raw)
      claudeCode = !!(config.mcpServers && config.mcpServers[MCP_SERVER_NAME])
    } catch {
      /* ignore */
    }
  }

  const geminiPath = join(homedir(), '.gemini', 'settings.json')
  if (existsSync(geminiPath)) {
    try {
      const raw = readFileSync(geminiPath, 'utf-8')
      const settings: GeminiSettings = JSON.parse(raw)
      geminiCli = !!(settings.mcpServers && settings.mcpServers[MCP_SERVER_NAME])
    } catch {
      /* ignore */
    }
  }

  const codexPath = join(homedir(), '.codex', 'config.toml')
  if (existsSync(codexPath)) {
    try {
      const content = readFileSync(codexPath, 'utf-8')
      codexCli = content.includes(TOML_SECTION_HEADER)
    } catch {
      /* ignore */
    }
  }

  return { claudeCode, geminiCli, codexCli, configPath }
}
