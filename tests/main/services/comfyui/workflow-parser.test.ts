import { describe, it, expect } from 'vitest'
import { parseWorkflow } from '../../../../src/main/services/comfyui/workflow-parser'

// Minimal ComfyUI API-format workflow JSON fixtures
function makeGenerationWorkflow(): string {
  return JSON.stringify({
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'model.safetensors' },
      _meta: { title: 'Load Checkpoint' }
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'masterpiece, 1girl', clip: ['1', 1] },
      _meta: { title: 'Positive Prompt' }
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'worst quality, bad anatomy, ugly, deformed',
        clip: ['1', 1]
      },
      _meta: { title: 'Negative Prompt' }
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 768, batch_size: 1 },
      _meta: { title: 'Empty Latent' }
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 123456,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0]
      },
      _meta: { title: 'KSampler' }
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
      _meta: { title: 'VAE Decode' }
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'output', images: ['6', 0] },
      _meta: { title: 'Save Image' }
    }
  })
}

function makeUpscaleWorkflow(): string {
  return JSON.stringify({
    '1': {
      class_type: 'UpscaleModelLoader',
      inputs: { model_name: '4x-UltraSharp.pth' },
      _meta: { title: 'Load Upscale Model' }
    },
    '2': {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['1', 0], image: ['3', 0] },
      _meta: { title: 'Upscale Image' }
    },
    '3': {
      class_type: 'LoadImage',
      inputs: { image: 'input.png', upload: 'image' },
      _meta: { title: 'Load Image' }
    }
  })
}

function makeDetailerWorkflow(): string {
  return JSON.stringify({
    '1': {
      class_type: 'FaceDetailer',
      inputs: { guide_size: 256, steps: 20, image: ['2', 0] },
      _meta: { title: 'Face Detailer' }
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: 'input.png' },
      _meta: { title: 'Load Image' }
    },
    '3': {
      class_type: 'UltralyticsDetectorProvider',
      inputs: { model_name: 'face_yolov8m.pt' },
      _meta: { title: 'Detector' }
    }
  })
}

function makeCustomWorkflow(): string {
  return JSON.stringify({
    '1': {
      class_type: 'SomeCustomNode',
      inputs: { value: 42, text: 'custom input' },
      _meta: { title: 'Custom Node' }
    }
  })
}

describe('Workflow Parser', () => {
  describe('parseWorkflow', () => {
    it('throws a helpful error for invalid workflow JSON', () => {
      expect(() => parseWorkflow('{', 'Broken Workflow')).toThrow(/Workflow JSON/)
    })

    it('extracts variables from known node types', () => {
      const result = parseWorkflow(makeGenerationWorkflow(), 'Test')
      expect(result.name).toBe('Test')

      // KSampler should have seed, steps, cfg, etc.
      const ksamplerVars = result.variables.filter((v) => v.nodeType === 'KSampler')
      expect(ksamplerVars.length).toBeGreaterThanOrEqual(5) // seed, steps, cfg, sampler_name, scheduler, denoise

      const seedVar = ksamplerVars.find((v) => v.fieldName === 'seed')
      expect(seedVar).toBeDefined()
      expect(seedVar!.varType).toBe('seed')
      expect(seedVar!.currentValue).toBe(123456)
    })

    it('extracts variables from CLIPTextEncode', () => {
      const result = parseWorkflow(makeGenerationWorkflow())
      const textVars = result.variables.filter(
        (v) => v.nodeType === 'CLIPTextEncode' && v.fieldName === 'text'
      )
      expect(textVars).toHaveLength(2)
    })

    it('skips node link arrays (not extracting as variables)', () => {
      const result = parseWorkflow(makeGenerationWorkflow())
      // KSampler has model, positive, negative, latent_image as links
      const linkVars = result.variables.filter(
        (v) =>
          v.nodeType === 'KSampler' &&
          ['model', 'positive', 'negative', 'latent_image'].includes(v.fieldName)
      )
      expect(linkVars).toHaveLength(0)
    })

    it('detects generation category', () => {
      const result = parseWorkflow(makeGenerationWorkflow())
      expect(result.suggestedCategory).toBe('generation')
    })

    it('detects upscale category', () => {
      const result = parseWorkflow(makeUpscaleWorkflow())
      expect(result.suggestedCategory).toBe('upscale')
    })

    it('detects detailer category', () => {
      const result = parseWorkflow(makeDetailerWorkflow())
      expect(result.suggestedCategory).toBe('detailer')
    })

    it('detects custom category for unknown workflows', () => {
      const result = parseWorkflow(makeCustomWorkflow())
      expect(result.suggestedCategory).toBe('custom')
    })

    it('uses default name when not provided', () => {
      const result = parseWorkflow(makeGenerationWorkflow())
      expect(result.name).toBe('Imported Workflow')
    })

    it('extracts EmptyLatentImage variables', () => {
      const result = parseWorkflow(makeGenerationWorkflow())
      const latentVars = result.variables.filter((v) => v.nodeType === 'EmptyLatentImage')
      expect(latentVars.some((v) => v.fieldName === 'width')).toBe(true)
      expect(latentVars.some((v) => v.fieldName === 'height')).toBe(true)
    })

    it('extracts variables from unknown node types via inference', () => {
      const result = parseWorkflow(makeCustomWorkflow())
      const vars = result.variables.filter((v) => v.nodeType === 'SomeCustomNode')
      expect(vars.length).toBeGreaterThanOrEqual(1)
      // 'value' (number) and 'text' (string) should be detected
      expect(vars.some((v) => v.fieldName === 'value' && v.varType === 'number')).toBe(true)
      expect(vars.some((v) => v.fieldName === 'text' && v.varType === 'text')).toBe(true)
    })

    it('constructs display names from node title and field', () => {
      const result = parseWorkflow(makeGenerationWorkflow())
      const seedVar = result.variables.find(
        (v) => v.nodeType === 'KSampler' && v.fieldName === 'seed'
      )
      expect(seedVar!.displayName).toBe('KSampler - Seed')
    })

    it('throws on invalid JSON', () => {
      expect(() => parseWorkflow('not json')).toThrow()
    })
  })
})
