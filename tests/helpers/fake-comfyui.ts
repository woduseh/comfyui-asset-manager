import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer, WebSocket } from 'ws'
import type {
  ComfyUIHistoryEntry,
  ComfyUIPromptRequest,
  ComfyUIWSMessage
} from '../../src/main/services/comfyui/types'

export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

export interface AcceptedPrompt {
  id: string
  body: ComfyUIPromptRequest & { prompt_id?: string }
}

/** Loopback-only protocol fixture. Hooks are barriers, not timing assumptions. */
export class FakeComfyUIServer {
  readonly host = '127.0.0.1'
  port = 0
  readonly accepted: AcceptedPrompt[] = []
  readonly history = new Map<string, ComfyUIHistoryEntry>()
  readonly images = new Map<string, Buffer>()
  readonly failedImages = new Set<string>()
  readonly requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  readonly pending = new Set<string>()
  readonly running = new Set<string>()
  interrupts = 0
  onPrompt?: (prompt: AcceptedPrompt) => Promise<'drop' | void> | 'drop' | void
  onImage?: (filename: string) => Promise<void> | void
  onHistory?: (promptId: string | undefined) => Promise<void> | void
  private readonly sockets = new Map<WebSocket, string>()
  private readonly changed = new WebSocketServer({ noServer: true })
  private readonly http = createServer((req, res) => {
    void this.handle(req, res).catch((error: unknown) => {
      if (!res.destroyed) {
        res.writeHead(500)
        res.end(String(error))
      }
    })
  })

  static async start(): Promise<FakeComfyUIServer> {
    const server = new FakeComfyUIServer()
    server.http.on('upgrade', (req, socket, head) => {
      server.changed.handleUpgrade(req, socket, head, (ws) => {
        server.sockets.set(
          ws,
          new URL(req.url!, 'http://localhost').searchParams.get('clientId') ?? ''
        )
        ws.on('close', () => server.sockets.delete(ws))
        server.changed.emit('connection', ws, req)
      })
    })
    server.http.listen(0, server.host)
    await once(server.http, 'listening')
    const address = server.http.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')
    server.port = address.port
    return server
  }

  async waitForPrompt(count = 1): Promise<AcceptedPrompt> {
    while (this.accepted.length < count) await once(this.http, 'accepted')
    return this.accepted[count - 1]
  }

  async waitForClients(count = 1): Promise<void> {
    while (this.sockets.size < count) await once(this.changed, 'connection')
  }

  send(message: ComfyUIWSMessage, clientId?: string): void {
    for (const [ws, id] of this.sockets) {
      if (ws.readyState === WebSocket.OPEN && (!clientId || id === clientId)) {
        ws.send(JSON.stringify(message))
      }
    }
  }

  complete(promptId: string, filenames: string[] = ['image.png']): void {
    const accepted = this.accepted.find((prompt) => prompt.id === promptId)
    if (!accepted) throw new Error(`Unknown prompt: ${promptId}`)
    this.pending.delete(promptId)
    this.running.delete(promptId)
    this.history.set(promptId, {
      prompt: [0, promptId, accepted.body.prompt, accepted.body.extra_data ?? {}],
      outputs: {
        '1': { images: filenames.map((filename) => ({ filename, subfolder: '', type: 'output' })) }
      },
      status: { status_str: 'success', completed: true }
    })
    for (const filename of filenames) {
      if (!this.images.has(filename)) this.images.set(filename, Buffer.from(`image:${filename}`))
    }
    this.send(
      { type: 'executing', data: { prompt_id: promptId, node: null } },
      accepted.body.client_id
    )
  }

  disconnectClients(): void {
    for (const ws of this.sockets.keys()) ws.terminate()
  }

  async close(): Promise<void> {
    this.disconnectClients()
    await new Promise<void>((resolve) => this.changed.close(() => resolve()))
    this.http.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      this.http.close((error) => (error ? reject(error) : resolve()))
    )
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, 'http://localhost')
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString()
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    this.requests.push({ method: req.method!, path: url.pathname, body })
    const json = (value: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname === '/prompt' && req.method === 'POST') {
      const accepted = {
        id:
          typeof body.prompt_id === 'string'
            ? body.prompt_id
            : `prompt-${this.accepted.length + 1}`,
        body: body as unknown as AcceptedPrompt['body']
      }
      this.accepted.push(accepted)
      this.pending.add(accepted.id)
      this.http.emit('accepted')
      if ((await this.onPrompt?.(accepted)) === 'drop') {
        res.destroy()
        return
      }
      json({ prompt_id: accepted.id, number: this.accepted.length, node_errors: {} })
    } else if (url.pathname === '/system_stats') {
      json({ system: {}, devices: [] })
    } else if (url.pathname === '/queue') {
      if (req.method === 'POST') {
        if (body.clear) this.pending.clear()
        for (const id of (body.delete as string[]) ?? []) this.pending.delete(id)
      }
      const entries = (ids: Set<string>): unknown[] =>
        this.accepted
          .filter((p) => ids.has(p.id))
          .map((p, i) => [
            i,
            p.id,
            p.body.prompt,
            { ...p.body.extra_data, client_id: p.body.client_id }
          ])
      json({ queue_pending: entries(this.pending), queue_running: entries(this.running) })
    } else if (url.pathname === '/interrupt') {
      this.interrupts++
      json({})
    } else if (url.pathname.startsWith('/history')) {
      if (req.method === 'POST') {
        if (body.clear) this.history.clear()
        for (const id of (body.delete as string[]) ?? []) this.history.delete(id)
      }
      const id = url.pathname.split('/')[2]
      await this.onHistory?.(id)
      json(Object.fromEntries([...this.history].filter(([key]) => !id || key === id)))
    } else if (url.pathname === '/view') {
      const filename = url.searchParams.get('filename')!
      await this.onImage?.(filename)
      if (this.failedImages.has(filename)) {
        res.writeHead(500)
        res.end('Injected download failure')
        return
      }
      const image = this.images.get(filename)
      res.writeHead(image ? 200 : 404, { 'content-type': 'application/octet-stream' })
      res.end(image ?? 'Missing image')
    } else {
      res.writeHead(404)
      res.end()
    }
  }
}
