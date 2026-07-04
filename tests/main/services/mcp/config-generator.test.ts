import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tempDirs: string[] = []
const TEST_TOKEN = 'a'.repeat(64)

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'comfyui-asset-manager-mcp-'))
  tempDirs.push(dir)
  return dir
}

async function loadConfigGenerator(homeDir: string): Promise<
  typeof import('../../../../src/main/services/mcp/config-generator') & {
    logger: {
      warn: ReturnType<typeof vi.fn>
      info: ReturnType<typeof vi.fn>
      debug: ReturnType<typeof vi.fn>
      error: ReturnType<typeof vi.fn>
    }
  }
> {
  vi.resetModules()

  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }

  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os')
    return { ...actual, homedir: () => homeDir }
  })
  vi.doMock('../../../../src/main/logger', () => ({ default: logger }))

  const module = await import('../../../../src/main/services/mcp/config-generator')
  return { ...module, logger }
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('os')
  vi.doUnmock('../../../../src/main/logger')

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('parseJsonConfigText', () => {
  it('returns parsed JSON for valid text', async () => {
    const { parseJsonConfigText } = await loadConfigGenerator(createTempHome())

    expect(parseJsonConfigText('{"mcpServers":{}}', 'test config')).toEqual({ mcpServers: {} })
  })

  it('returns null for invalid JSON text', async () => {
    const { parseJsonConfigText, logger } = await loadConfigGenerator(createTempHome())

    expect(parseJsonConfigText('{', 'broken config')).toBeNull()
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('returns null for whitespace-only JSON text', async () => {
    const { parseJsonConfigText } = await loadConfigGenerator(createTempHome())

    expect(parseJsonConfigText('   ', 'blank config')).toBeNull()
  })
})

describe('writeMcpJsonConfig', () => {
  it('creates a .mcp.json file with the comfyui asset manager entry', async () => {
    const homeDir = createTempHome()
    const { writeMcpJsonConfig } = await loadConfigGenerator(homeDir)

    const filePath = writeMcpJsonConfig('http://127.0.0.1:39464/mcp', TEST_TOKEN, homeDir)

    expect(filePath).toBe(join(homeDir, '.mcp.json'))
    expect(existsSync(filePath)).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({
      mcpServers: {
        'comfyui-asset-manager': {
          type: 'http',
          url: 'http://127.0.0.1:39464/mcp',
          headers: { Authorization: `Bearer ${TEST_TOKEN}` }
        }
      }
    })
  })

  it('preserves existing servers when merging into .mcp.json', async () => {
    const homeDir = createTempHome()
    const filePath = join(homeDir, '.mcp.json')
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          mcpServers: {
            existing: { url: 'https://example.com/mcp' }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    const { writeMcpJsonConfig } = await loadConfigGenerator(homeDir)
    writeMcpJsonConfig('http://localhost:39464/mcp', TEST_TOKEN, homeDir)

    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({
      mcpServers: {
        existing: { url: 'https://example.com/mcp' },
        'comfyui-asset-manager': {
          type: 'http',
          url: 'http://localhost:39464/mcp',
          headers: { Authorization: `Bearer ${TEST_TOKEN}` }
        }
      }
    })
  })

  it('does not modify Codex config.toml', async () => {
    const homeDir = createTempHome()
    const codexDir = join(homeDir, '.codex')
    const codexPath = join(codexDir, 'config.toml')
    const original = '[mcp_servers.existing]\nurl = "https://example.com/mcp"\n'
    mkdirSync(codexDir)
    writeFileSync(codexPath, original, 'utf-8')

    const { writeMcpJsonConfig } = await loadConfigGenerator(homeDir)
    writeMcpJsonConfig('http://127.0.0.1:39464/mcp', TEST_TOKEN, homeDir)

    expect(readFileSync(codexPath, 'utf-8')).toBe(original)
  })

  it('writes authenticated Gemini and Copilot HTTP configurations', async () => {
    const homeDir = createTempHome()
    mkdirSync(join(homeDir, '.gemini'))
    mkdirSync(join(homeDir, '.copilot'))
    const { writeMcpJsonConfig } = await loadConfigGenerator(homeDir)

    writeMcpJsonConfig('http://127.0.0.1:39464/mcp', TEST_TOKEN, homeDir)

    const gemini = JSON.parse(readFileSync(join(homeDir, '.gemini', 'settings.json'), 'utf-8'))
    expect(gemini.mcpServers['comfyui-asset-manager']).toEqual({
      httpUrl: 'http://127.0.0.1:39464/mcp',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    })

    const copilot = JSON.parse(readFileSync(join(homeDir, '.copilot', 'mcp-config.json'), 'utf-8'))
    expect(copilot.mcpServers['comfyui-asset-manager']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:39464/mcp',
      tools: ['*'],
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    })
  })
})

describe('removeMcpJsonConfig', () => {
  it('removes only the comfyui asset manager entry from .mcp.json', async () => {
    const homeDir = createTempHome()
    const filePath = join(homeDir, '.mcp.json')
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          mcpServers: {
            existing: { url: 'https://example.com/mcp' },
            'comfyui-asset-manager': { url: 'http://localhost:39464/mcp' }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    const { removeMcpJsonConfig } = await loadConfigGenerator(homeDir)

    expect(removeMcpJsonConfig(homeDir)).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({
      mcpServers: {
        existing: { url: 'https://example.com/mcp' }
      }
    })
  })

  it('returns false when .mcp.json does not exist', async () => {
    const homeDir = createTempHome()
    const { removeMcpJsonConfig } = await loadConfigGenerator(homeDir)

    expect(removeMcpJsonConfig(homeDir)).toBe(false)
  })

  it('returns false for corrupted .mcp.json without throwing', async () => {
    const homeDir = createTempHome()
    const filePath = join(homeDir, '.mcp.json')
    writeFileSync(filePath, '{', 'utf-8')

    const { removeMcpJsonConfig } = await loadConfigGenerator(homeDir)

    expect(removeMcpJsonConfig(homeDir)).toBe(false)
    expect(readFileSync(filePath, 'utf-8')).toBe('{')
  })

  it('does not remove manually managed Codex configuration', async () => {
    const homeDir = createTempHome()
    const codexDir = join(homeDir, '.codex')
    const codexPath = join(codexDir, 'config.toml')
    const original = '[mcp_servers."comfyui-asset-manager"]\nurl = "http://127.0.0.1:39464/mcp"\n'
    mkdirSync(codexDir)
    writeFileSync(codexPath, original, 'utf-8')

    const { removeMcpJsonConfig } = await loadConfigGenerator(homeDir)

    expect(removeMcpJsonConfig(homeDir)).toBe(false)
    expect(readFileSync(codexPath, 'utf-8')).toBe(original)
  })
})

describe('getMcpConfigStatus', () => {
  it('reports whether configured clients carry the current authentication token', async () => {
    const homeDir = createTempHome()
    const codexDir = join(homeDir, '.codex')
    mkdirSync(codexDir)
    writeFileSync(
      join(codexDir, 'config.toml'),
      [
        '[mcp_servers."comfyui-asset-manager"]',
        'url = "http://127.0.0.1:39464/mcp"',
        'bearer_token_env_var = "COMFYUI_ASSET_MANAGER_MCP_TOKEN"'
      ].join('\n'),
      'utf-8'
    )
    const { getMcpConfigStatus, writeMcpJsonConfig } = await loadConfigGenerator(homeDir)
    writeMcpJsonConfig('http://127.0.0.1:39464/mcp', TEST_TOKEN, homeDir)

    const current = getMcpConfigStatus(TEST_TOKEN, true, homeDir)
    const rotated = getMcpConfigStatus('b'.repeat(64), true, homeDir)

    expect(current.claudeCode).toBe(true)
    expect(current.authReady.claudeCode).toBe(true)
    expect(current.authReady.codexCli).toBe(true)
    expect(rotated.authReady.claudeCode).toBe(false)
    expect(rotated.authReady.codexCli).toBe(true)
  })
})
