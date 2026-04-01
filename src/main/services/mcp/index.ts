import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerMcpTools } from './tools'
import { writeMcpJsonConfig, removeMcpJsonConfig } from './config-generator'
import { tagService } from '../tags'
import http from 'http'
import { randomUUID } from 'crypto'
import {
  DEFAULT_MCP_PORT,
  MAX_MCP_SESSIONS,
  MCP_SESSION_TIMEOUT_MS,
  MCP_CLEANUP_INTERVAL_MS,
  MCP_ALLOWED_ORIGIN_HOSTS
} from '../../constants'
import log from '../../logger'

const SERVER_NAME = 'comfyui-asset-manager'
const SERVER_VERSION = '0.8.0'

interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  lastActivity: number
}

const MCP_ALLOWED_ORIGIN_HOST_SET = new Set<string>(MCP_ALLOWED_ORIGIN_HOSTS)

function appendVaryHeader(res: http.ServerResponse, value: string): void {
  const current = res.getHeader('Vary')
  const values =
    typeof current === 'string'
      ? current
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : Array.isArray(current)
        ? current.map((entry) => String(entry).trim()).filter(Boolean)
        : []

  if (!values.includes(value)) {
    values.push(value)
  }

  res.setHeader('Vary', values.join(', '))
}

function getAllowedLoopbackOrigin(
  originHeader: string | string[] | undefined
): string | null | undefined {
  if (originHeader === undefined) {
    return undefined
  }

  if (Array.isArray(originHeader)) {
    return null
  }

  try {
    const origin = new URL(originHeader)
    if (!['http:', 'https:'].includes(origin.protocol)) {
      return null
    }

    if (!MCP_ALLOWED_ORIGIN_HOST_SET.has(origin.hostname)) {
      return null
    }

    return origin.origin
  } catch (error) {
    void error
    // Malformed Origin headers are rejected the same way as disallowed origins.
    return null
  }
}

function setMcpCorsHeaders(res: http.ServerResponse, allowedOrigin?: string): void {
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    appendVaryHeader(res, 'Origin')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
}

class McpServerManager {
  private httpServer: http.Server | null = null
  private sessions = new Map<string, McpSession>()
  private _isRunning = false
  private _port = DEFAULT_MCP_PORT
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
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), MCP_CLEANUP_INTERVAL_MS)
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
      if (now - session.lastActivity > MCP_SESSION_TIMEOUT_MS) {
        log.info(`[MCP] Cleaning up stale session: ${id}`)
        this.destroySession(id, session)
      }
    }
  }

  private destroySession(id: string, session: McpSession): void {
    try {
      session.transport.close().catch((e) => {
        log.debug(`[MCP] Transport close error for session ${id}:`, e)
      })
      session.server.close().catch((e) => {
        log.debug(`[MCP] Server close error for session ${id}:`, e)
      })
    } catch (e) {
      log.debug(`[MCP] Session destroy error for ${id}:`, e)
    }
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
      log.info(`[MCP] Evicting oldest session: ${oldestId}`)
      this.destroySession(oldestId, this.sessions.get(oldestId)!)
    }
  }

  async start(port?: number): Promise<void> {
    if (this._isRunning) return

    this._port = port || DEFAULT_MCP_PORT

    // Load Danbooru tag database
    if (!tagService.isLoaded()) {
      tagService.load()
    }

    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this._port}`)

      if (url.pathname === '/mcp') {
        const allowedOrigin = getAllowedLoopbackOrigin(req.headers.origin)
        if (allowedOrigin === null) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden origin')
          return
        }

        setMcpCorsHeaders(res, allowedOrigin)

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        try {
          await this.handleMcpRequest(req, res)
        } catch (error) {
          log.error('[MCP] Unhandled error:', error)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null
              })
            )
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
        log.info(`[MCP] Server started on ${this.url}`)
        try {
          const configPath = writeMcpJsonConfig(this.url)
          log.info(`[MCP] Config written to ${configPath}`)
        } catch (err) {
          log.warn('[MCP] Failed to write config:', err)
        }
        resolve()
      })

      this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          this._port = this._port + 1
          log.info(`[MCP] Port in use, trying ${this._port}`)
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
      if (this.sessions.size >= MAX_MCP_SESSIONS) {
        this.evictOldestSession()
      }

      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
      registerMcpTools(server)

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          log.info(`[MCP] Session initialized: ${sid} (active: ${this.sessions.size + 1})`)
          this.sessions.set(sid, { transport, server, lastActivity: Date.now() })
        }
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid && this.sessions.has(sid)) {
          log.info(`[MCP] Session closed: ${sid} (active: ${this.sessions.size - 1})`)
          this.sessions.delete(sid)
        }
        server.close().catch((e) => {
          log.debug('[MCP] Server close error on transport close:', e)
        })
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
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null
          })
        )
      }
      return
    }

    if (req.method === 'DELETE') {
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)!
        await session.transport.handleRequest(req, res)
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null
          })
        )
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
          log.info('[MCP] Server stopped')
          try {
            removeMcpJsonConfig()
          } catch (e) {
            log.warn('[MCP] Failed to remove config file:', e)
          }
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
