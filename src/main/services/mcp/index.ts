import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerMcpTools } from './tools'
import { writeMcpJsonConfig, removeMcpJsonConfig } from './config-generator'
import http from 'http'
import { randomUUID } from 'crypto'

const DEFAULT_PORT = 39464
const SERVER_NAME = 'comfyui-asset-manager'
const SERVER_VERSION = '0.7.1'

// Stored per-session: transport + the McpServer instance driving it
interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
}

class McpServerManager {
  private httpServer: http.Server | null = null
  private sessions = new Map<string, McpSession>()
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
          await this.handleMcpRequest(req, res)
        } catch (error) {
          console.error('[MCP] Unhandled error:', error)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null
            }))
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
          this._port = this._port + 1
          console.log(`[MCP] Port in use, trying ${this._port}`)
          this.httpServer!.listen(this._port, '127.0.0.1')
        } else {
          reject(err)
        }
      })
    })
  }

  private async handleMcpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (req.method === 'POST') {
      // ── Existing session → delegate ──
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)!
        await session.transport.handleRequest(req, res)
        return
      }

      // ── New session (initialization) ──
      // Following the official SDK example pattern:
      // 1. Create transport with onsessioninitialized callback for session storage
      // 2. Connect server to transport
      // 3. handleRequest() triggers session init → callback stores session
      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
      registerMcpTools(server)

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          console.log(`[MCP] Session initialized: ${sid}`)
          this.sessions.set(sid, { transport, server })
        }
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid && this.sessions.has(sid)) {
          console.log(`[MCP] Session closed: ${sid}`)
          this.sessions.delete(sid)
        }
        server.close().catch(() => {})
      }

      await server.connect(transport)
      await transport.handleRequest(req, res)
      return
    }

    if (req.method === 'GET') {
      // SSE stream — requires existing session
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)!
        await session.transport.handleRequest(req, res)
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null
        }))
      }
      return
    }

    if (req.method === 'DELETE') {
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)!
        await session.transport.handleRequest(req, res)
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null
        }))
      }
      return
    }

    res.writeHead(405)
    res.end('Method not allowed')
  }

  async stop(): Promise<void> {
    if (!this._isRunning) return

    for (const [id, session] of this.sessions) {
      try {
        await session.transport.close()
        await session.server.close()
      } catch { /* ignore */ }
      this.sessions.delete(id)
    }

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this._isRunning = false
          this.httpServer = null
          console.log('[MCP] Server stopped')
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
