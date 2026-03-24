import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'http'

vi.mock('../../../../src/main/services/mcp/tools', () => ({
  registerMcpTools: vi.fn()
}))

vi.mock('../../../../src/main/services/mcp/config-generator', () => ({
  writeMcpJsonConfig: vi.fn(() => 'mock-config-path'),
  removeMcpJsonConfig: vi.fn(() => true)
}))

vi.mock('../../../../src/main/services/tags', () => ({
  tagService: {
    isLoaded: vi.fn(() => true),
    load: vi.fn()
  }
}))

import { mcpServerManager } from '../../../../src/main/services/mcp/index'

async function getAvailablePort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to allocate a test port')
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  return address.port
}

async function request(
  port: number,
  path: string,
  options: { method?: string; headers?: http.OutgoingHttpHeaders } = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body
          })
        })
      }
    )

    req.on('error', reject)
    req.end()
  })
}

describe('McpServerManager origin policy', () => {
  afterEach(async () => {
    await mcpServerManager.stop()
  })

  it('allows requests without an Origin header', async () => {
    const port = await getAvailablePort()
    await mcpServerManager.start(port)

    const response = await request(port, '/mcp')

    expect(response.statusCode).toBe(400)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows localhost origins', async () => {
    const port = await getAvailablePort()
    await mcpServerManager.start(port)

    const response = await request(port, '/mcp', {
      headers: { Origin: 'http://localhost:3000' }
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })

  it('allows 127.0.0.1 origins', async () => {
    const port = await getAvailablePort()
    await mcpServerManager.start(port)

    const response = await request(port, '/mcp', {
      headers: { Origin: 'http://127.0.0.1:8188' }
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:8188')
  })

  it('rejects external origins', async () => {
    const port = await getAvailablePort()
    await mcpServerManager.start(port)

    const response = await request(port, '/mcp', {
      headers: { Origin: 'https://evil.example' }
    })

    expect(response.statusCode).toBe(403)
    expect(response.body).toContain('Forbidden')
  })

  it('keeps the health endpoint available', async () => {
    const port = await getAvailablePort()
    await mcpServerManager.start(port)

    const response = await request(port, '/health', {
      headers: { Origin: 'https://evil.example' }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' })
  })
})
