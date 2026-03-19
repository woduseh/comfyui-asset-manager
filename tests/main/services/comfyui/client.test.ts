import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ComfyUIClient } from '../../../../src/main/services/comfyui/client'

// Mock ofetch
const mockFetch = vi.fn()
vi.mock('ofetch', () => ({
  ofetch: (...args: unknown[]) => mockFetch(...args)
}))

describe('ComfyUI REST Client', () => {
  let client: ComfyUIClient

  beforeEach(() => {
    client = new ComfyUIClient('localhost', 8188)
    mockFetch.mockReset()
  })

  it('constructs correct base URL', () => {
    expect(client.getBaseUrl()).toBe('http://localhost:8188')
  })

  it('updates server address', () => {
    client.setServer('192.168.1.100', 9000)
    expect(client.getBaseUrl()).toBe('http://192.168.1.100:9000')
  })

  describe('ping', () => {
    it('returns true when server responds', async () => {
      mockFetch.mockResolvedValueOnce({ system: {}, devices: [] })
      const result = await client.ping()
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8188/system_stats', expect.any(Object))
    })

    it('returns false when server is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await client.ping()
      expect(result).toBe(false)
    })
  })

  describe('getSystemStats', () => {
    it('returns system stats', async () => {
      const stats = {
        system: { os: 'windows', python_version: '3.11', embedded_python: true },
        devices: [{ name: 'cuda:0', type: 'cuda', vram_total: 12000000000 }]
      }
      mockFetch.mockResolvedValueOnce(stats)
      const result = await client.getSystemStats()
      expect(result).toEqual(stats)
    })
  })

  describe('queuePrompt', () => {
    it('sends prompt to ComfyUI', async () => {
      const response = { prompt_id: 'abc-123', number: 1, node_errors: {} }
      mockFetch.mockResolvedValueOnce(response)

      const prompt = { '1': { class_type: 'KSampler', inputs: {} } }
      const result = await client.queuePrompt(prompt, 'client-1')
      expect(result).toEqual(response)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8188/prompt',
        expect.objectContaining({
          method: 'POST',
          body: { prompt, client_id: 'client-1' }
        })
      )
    })
  })

  describe('getQueue', () => {
    it('returns queue state', async () => {
      const queue = { queue_running: [], queue_pending: [] }
      mockFetch.mockResolvedValueOnce(queue)
      const result = await client.getQueue()
      expect(result).toEqual(queue)
    })
  })

  describe('getHistory', () => {
    it('fetches all history when no promptId', async () => {
      mockFetch.mockResolvedValueOnce({})
      await client.getHistory()
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8188/history')
    })

    it('fetches specific prompt history', async () => {
      const entry = { prompt: [], outputs: {}, status: { status_str: 'success', completed: true } }
      mockFetch.mockResolvedValueOnce({ 'abc-123': entry })
      const result = await client.getHistoryEntry('abc-123')
      expect(result).toEqual(entry)
    })

    it('returns null for non-existent prompt', async () => {
      mockFetch.mockResolvedValueOnce({})
      const result = await client.getHistoryEntry('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('getImage', () => {
    it('fetches image with correct query params', async () => {
      const buffer = Buffer.from('fake-image-data')
      mockFetch.mockResolvedValueOnce(buffer)
      await client.getImage('output.png', 'subfolder', 'output')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/view?'),
        expect.any(Object)
      )
    })
  })

  describe('interrupt', () => {
    it('sends interrupt request', async () => {
      mockFetch.mockResolvedValueOnce(undefined)
      await client.interrupt()
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8188/interrupt',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('deleteFromQueue', () => {
    it('sends delete request', async () => {
      mockFetch.mockResolvedValueOnce(undefined)
      await client.deleteFromQueue(['id1', 'id2'])
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8188/queue',
        expect.objectContaining({
          method: 'POST',
          body: { delete: ['id1', 'id2'] }
        })
      )
    })
  })

  describe('clearQueue', () => {
    it('sends clear request', async () => {
      mockFetch.mockResolvedValueOnce(undefined)
      await client.clearQueue()
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8188/queue',
        expect.objectContaining({
          method: 'POST',
          body: { clear: true }
        })
      )
    })
  })

  describe('getAvailableModels', () => {
    it('extracts model lists from object info', async () => {
      mockFetch.mockResolvedValueOnce({
        CheckpointLoaderSimple: {
          input: {
            required: {
              ckpt_name: [['model1.safetensors', 'model2.safetensors']]
            }
          }
        },
        LoraLoader: {
          input: {
            required: {
              lora_name: [['lora1.safetensors']]
            }
          }
        },
        VAELoader: {
          input: {
            required: {
              vae_name: [['vae1.pt']]
            }
          }
        },
        UpscaleModelLoader: {
          input: {
            required: {
              model_name: [['4x-UltraSharp.pth']]
            }
          }
        },
        KSampler: {
          input: {
            required: {
              sampler_name: [['euler', 'euler_ancestral']],
              scheduler: [['normal', 'karras']]
            }
          }
        }
      })
      const result = await client.getAvailableModels()
      expect(result.checkpoints).toEqual(['model1.safetensors', 'model2.safetensors'])
      expect(result.loras).toEqual(['lora1.safetensors'])
      expect(result.vaes).toEqual(['vae1.pt'])
      expect(result.upscaleModels).toEqual(['4x-UltraSharp.pth'])
      expect(result.samplers).toEqual(['euler', 'euler_ancestral'])
      expect(result.schedulers).toEqual(['normal', 'karras'])
    })
  })
})
