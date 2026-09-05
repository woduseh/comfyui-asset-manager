import { describe, expect, it } from 'vitest'
import type { ComfyUINode, ComfyUIObjectInfo } from '../../../../src/main/services/comfyui/types'
import { validateWorkflowGraph } from '../../../../src/main/services/comfyui/workflow-validation'

function schema(
  input: ComfyUIObjectInfo[string]['input'],
  output: string[],
  extra: Record<string, unknown> = {}
): ComfyUIObjectInfo[string] {
  return {
    input,
    output,
    output_is_list: output.map(() => false),
    output_name: output,
    name: 'Fixture',
    display_name: 'Fixture',
    description: '',
    category: 'test',
    ...extra
  }
}

const info: ComfyUIObjectInfo = {
  Load: schema(
    {
      required: {
        model: [['installed.safetensors']],
        seed: ['INT', { min: 0, max: 100 }],
        scale: ['FLOAT', { min: 0, max: 10 }],
        enabled: ['BOOLEAN'],
        prompt: ['STRING']
      },
      optional: { optional_text: ['STRING'] },
      hidden: { unique_id: 'UNIQUE_ID' }
    } as ComfyUIObjectInfo[string]['input'],
    ['IMAGE']
  ),
  SaveImage: schema(
    { required: { images: ['IMAGE'] }, optional: { filename_prefix: ['STRING'] } },
    [],
    { output_node: true }
  ),
  PreviewImage: schema({ required: { images: ['IMAGE'] } }, [], { output_node: true }),
  Relay: schema({ required: { images: ['IMAGE'] } }, ['IMAGE'])
}

function graph(): Record<string, ComfyUINode> {
  return {
    '1': {
      class_type: 'Load',
      inputs: {
        model: 'installed.safetensors',
        seed: 42,
        scale: 1.5,
        enabled: true,
        prompt: 'Alice smiling'
      }
    },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } }
  }
}

describe('installed ComfyUI workflow graph validation', () => {
  it('accepts installed model choices, primitive inputs, image links and hidden/optional omissions', () => {
    const nodes = graph()
    const before = JSON.stringify(nodes)
    const result = validateWorkflowGraph(nodes, info)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'STATIC_VALIDATION_ONLY' })
    )
    expect(JSON.stringify(nodes)).toBe(before)
  })

  it('rejects missing installed node types, required inputs, unknown inputs and unavailable models', () => {
    const nodes = graph()
    nodes['3'] = { class_type: 'NotInstalled', inputs: {} }
    delete nodes['1'].inputs.prompt
    nodes['1'].inputs.model = 'missing.safetensors'
    nodes['1'].inputs.unknown = 1
    expect(validateWorkflowGraph(nodes, info).errors.map((e) => e.code)).toEqual(
      expect.arrayContaining([
        'MISSING_NODE_TYPE',
        'MISSING_INPUT',
        'UNKNOWN_INPUT',
        'INVALID_CHOICE'
      ])
    )
  })

  it('rejects malformed primitives, nonfinite numbers and range violations', () => {
    const nodes = graph()
    nodes['1'].inputs.seed = 101
    nodes['1'].inputs.scale = Infinity
    nodes['1'].inputs.enabled = 'true'
    nodes['1'].inputs.prompt = 42
    const result = validateWorkflowGraph(nodes, info)
    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toEqual([
      'INPUT_MAX',
      'INPUT_TYPE_MISMATCH',
      'INPUT_TYPE_MISMATCH',
      'INPUT_TYPE_MISMATCH'
    ])
    nodes['1'].inputs.seed = -1
    expect(validateWorkflowGraph(nodes, info).errors[0].code).toBe('INPUT_MIN')
  })

  it.each([
    { link: ['absent', 0], code: 'MISSING_LINK_NODE' },
    { link: ['1', 2], code: 'LINK_SLOT_RANGE' },
    { link: ['1', -1], code: 'INVALID_LINK' },
    { link: ['1', 0, 'extra'], code: 'INVALID_LINK' }
  ])('rejects invalid links: $code', ({ link, code }) => {
    const nodes = graph()
    nodes['2'].inputs.images = link
    expect(validateWorkflowGraph(nodes, info).errors).toContainEqual(
      expect.objectContaining({ code, node_id: '2', field: 'images' })
    )
  })

  it('checks link types with union and wildcard support', () => {
    const nodes = graph()
    expect(
      validateWorkflowGraph(nodes, { ...info, Load: { ...info.Load, output: ['LATENT'] } }).errors
    ).toContainEqual(expect.objectContaining({ code: 'LINK_TYPE_MISMATCH' }))
    expect(
      validateWorkflowGraph(nodes, { ...info, Load: { ...info.Load, output: ['*'] } }).valid
    ).toBe(true)
    expect(
      validateWorkflowGraph(nodes, {
        ...info,
        SaveImage: schema({ required: { images: ['LATENT,IMAGE'] } }, [], { output_node: true })
      }).valid
    ).toBe(true)
  })

  it('detects cycles and requires a flagged image output', () => {
    const cyclic = {
      a: { class_type: 'Relay', inputs: { images: ['b', 0] } },
      b: { class_type: 'Relay', inputs: { images: ['a', 0] } }
    }
    expect(validateWorkflowGraph(cyclic, info).errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['CYCLE', 'MISSING_IMAGE_OUTPUT'])
    )
    expect(
      validateWorkflowGraph(graph(), {
        ...info,
        SaveImage: { ...info.SaveImage, output_node: false }
      }).errors
    ).toContainEqual(expect.objectContaining({ code: 'MISSING_IMAGE_OUTPUT' }))
    const nodes = graph()
    nodes['2'].class_type = 'PreviewImage'
    expect(validateWorkflowGraph(nodes, info).valid).toBe(true)
  })

  it('warns when hidden values or dynamic model choice links cannot be verified', () => {
    const nodes = graph()
    nodes['1'].inputs.unique_id = 'client value'
    nodes['1'].inputs.model = ['3', 0]
    nodes['3'] = { class_type: 'Text', inputs: {} }
    const result = validateWorkflowGraph(nodes, { ...info, Text: schema({}, ['STRING']) })
    expect(result.valid).toBe(true)
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['HIDDEN_INPUT', 'DYNAMIC_ENUM'])
    )
  })

  it('enforces node and issue bounds', () => {
    const nodes = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        String(index),
        { class_type: 'Unknown', inputs: {} }
      ])
    )
    expect(validateWorkflowGraph(nodes, info).errors[0].code).toBe('NODE_LIMIT')
    delete nodes['500']
    const result = validateWorkflowGraph(nodes, info)
    expect(result.errors).toHaveLength(100)
    expect(result.warnings.length).toBeLessThanOrEqual(20)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'ISSUES_TRUNCATED' }))
  })
})
