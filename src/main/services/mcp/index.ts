import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerMcpTools } from './tools'
import { writeMcpJsonConfig, removeMcpJsonConfig } from './config-generator'
import { tagService } from '../tags'
import http from 'http'
import { randomUUID } from 'crypto'

const DEFAULT_PORT = 39464
const SERVER_NAME = 'comfyui-asset-manager'
const SERVER_VERSION = '0.8.0'

const MAX_SESSIONS = 10
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  lastActivity: number
}

class McpServerManager {
  private httpServer: http.Server | null = null
  private sessions = new Map<string, McpSession>()
  private _isRunning = false
  private _port = DEFAULT_PORT
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  get isRunning(): boolean {
    return this._isRunning
  }

  get port(): number {
    return this._port
  }

  get url(): string {
    return `http://localhost:${this._port}/mcp`
  }

  private startCleanupTimer(): void {
    this.stopCleanupTimer()
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), 60_000)
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private cleanupStaleSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        console.log(`[MCP] Cleaning up stale session: ${id}`)
        this.destroySession(id, session)
      }
    }
  }

  private destroySession(id: string, session: McpSession): void {
    try {
      session.transport.close().catch(() => {})
      session.server.close().catch(() => {})
    } catch { /* ignore */ }
    this.sessions.delete(id)
  }

  private evictOldestSession(): void {
    let oldestId: string | null = null
    let oldestTime = Infinity
    for (const [id, session] of this.sessions) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity
        oldestId = id
      }
    }
    if (oldestId) {
      console.log(`[MCP] Evicting oldest session: ${oldestId}`)
      this.destroySession(oldestId, this.sessions.get(oldestId)!)
    }
  }

  async start(port?: number): Promise<void> {
    if (this._isRunning) return

    this._port = port || DEFAULT_PORT

    // Load Danbooru tag database
    if (!tagService.isLoaded()) {
      tagService.load()
    }

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
        this.startCleanupTimer()
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
        session.lastActivity = Date.now()
        await session.transport.handleRequest(req, res)
        return
      }

      // ── New session (initialization) ──
      // Evict oldest session if at capacity
      if (this.sessions.size >= MAX_SESSIONS) {
        this.evictOldestSession()
      }

      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
      registerMcpTools(server)

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          console.log(`[MCP] Session initialized: ${sid} (active: ${this.sessions.size + 1})`)
          this.sessions.set(sid, { transport, server, lastActivity: Date.now() })
        }
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid && this.sessions.has(sid)) {
          console.log(`[MCP] Session closed: ${sid} (active: ${this.sessions.size - 1})`)
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
        session.lastActivity = Date.now()
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

    this.stopCleanupTimer()

    for (const [id, session] of this.sessions) {
      this.destroySession(id, session)
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
