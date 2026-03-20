import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerMcpTools } from './tools'
import { writeMcpJsonConfig, removeMcpJsonConfig } from './config-generator'
import http from 'http'

const DEFAULT_PORT = 39464
const SERVER_NAME = 'comfyui-asset-manager'
const SERVER_VERSION = '0.7.0'

class McpServerManager {
  private server: McpServer | null = null
  private httpServer: http.Server | null = null
  private transport: StreamableHTTPServerTransport | null = null
  private _isRunning = false
  private _port = DEFAULT_PORT

  get isRunning(): boolean {
    return this._isRunning
  }

  get port(): number {
    return this._port
  }

  get url(): string {
    return `http://localhost:${this._port}/mcp`
  }

  async start(port?: number): Promise<void> {
    if (this._isRunning) return

    this._port = port || DEFAULT_PORT

    this.server = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION
    })

    registerMcpTools(this.server)

    this.httpServer = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${this._port}`)

      if (url.pathname === '/mcp') {
        try {
          this.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined
          })
          await this.server!.connect(this.transport)
          await this.transport.handleRequest(req, res)
        } catch (error) {
          console.error('[MCP] Request error:', error)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        }
      } else if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', name: SERVER_NAME, version: SERVER_VERSION }))
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this._port, '127.0.0.1', () => {
        this._isRunning = true
        console.log(`[MCP] Server started on ${this.url}`)
        // Auto-generate CLI config files
        try {
          const configPath = writeMcpJsonConfig(this.url)
          console.log(`[MCP] Config written to ${configPath}`)
        } catch (err) {
          console.warn('[MCP] Failed to write config:', err)
        }
        resolve()
      })

      this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Try alternate port
          this._port = this._port + 1
          console.log(`[MCP] Port in use, trying ${this._port}`)
          this.httpServer!.listen(this._port, '127.0.0.1')
        } else {
          reject(err)
        }
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._isRunning) return

    if (this.transport) {
      try {
        await this.transport.close()
      } catch { /* ignore */ }
      this.transport = null
    }

    if (this.server) {
      try {
        await this.server.close()
      } catch { /* ignore */ }
      this.server = null
    }

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this._isRunning = false
          this.httpServer = null
          console.log('[MCP] Server stopped')
          // Remove CLI config entry
          try {
            removeMcpJsonConfig()
          } catch { /* ignore */ }
          resolve()
        })
      } else {
        this._isRunning = false
        resolve()
      }
    })
  }
}

export const mcpServerManager = new McpServerManager()
