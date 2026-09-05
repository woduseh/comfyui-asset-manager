import { describe, expect, it, vi } from 'vitest'
import type { ComfyUIObjectInfo } from '../../../../src/main/services/comfyui/types'
import { prepareWorkflow } from '../../../../src/main/services/comfyui/workflow-preparation'
import { persistPreparedWorkflowImport } from '../../../../src/main/services/comfyui/workflow-import'

function node(
  required: Record<string, unknown[]>,
  output: string[],
  outputNode = false
): ComfyUIObjectInfo[string] {
  return {
    input: { required },
    output,
    output_node: outputNode,
    output_is_list: output.map(() => false),
    output_name: output,
    name: 'Fixture',
    display_name: 'Fixture',
    description: '',
    category: 'test'
  }
}

function catalog(): ComfyUIObjectInfo {
  return {
    CheckpointLoaderSimple: node({ ckpt_name: [['portrait.safetensors']] }, [
      'MODEL',
      'CLIP',
      'VAE'
    ]),
    CLIPTextEncode: node({ text: ['STRING'], clip: ['CLIP'] }, ['CONDITIONING']),
    EmptyLatentImage: node(
      { width: ['INT', { min: 64, max: 4096 }], height: ['INT'], batch_size: ['INT'] },
      ['LATENT']
    ),
    KSampler: node(
      {
        model: ['MODEL'],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        seed: ['INT'],
        steps: ['INT', { min: 1, max: 150 }],
        cfg: ['FLOAT'],
        sampler_name: [['euler', 'dpmpp_2m']],
        scheduler: [['normal', 'karras']],
        denoise: ['FLOAT']
      },
      ['LATENT']
    ),
    VAEDecode: node({ samples: ['LATENT'], vae: ['VAE'] }, ['IMAGE']),
    SaveImage: node({ images: ['IMAGE'], filename_prefix: ['STRING'] }, [], true),
    LoraLoader: node(
      {
        model: ['MODEL'],
        clip: ['CLIP'],
        lora_name: [['identity.safetensors', 'style.safetensors']],
        strength_model: ['FLOAT'],
        strength_clip: ['FLOAT']
      },
      ['MODEL', 'CLIP']
    )
  }
}

const recipe = { name: 'Portrait emotions', source: { kind: 'checkpoint_text_to_image' } }

describe('installed-catalog workflow preparation', () => {
  it('validates inherited roles while allowing an explicit corrective override', () => {
    const saved = {
      content: prepareWorkflow(recipe, catalog()).prepared.content,
      roles: [{ node_id: '5', field: 'cfg', role: 'prompt_positive' }]
    }
    const cloneInput = {
      name: 'Clone',
      source: { kind: 'saved_workflow', workflow_id: 'original' }
    }
    expect(() => prepareWorkflow(cloneInput, catalog(), saved)).toThrow(/text input/)
    const repaired = prepareWorkflow(
      { ...cloneInput, roles: [{ node_id: '5', field: 'cfg', role: 'custom' }] },
      catalog(),
      saved
    )
    expect(repaired.validation.valid).toBe(true)
    expect(
      repaired.prepared.parsed.variables.find((v) => v.nodeId === '5' && v.fieldName === 'cfg')!
        .role
    ).toBe('custom')
  })

  it('rejects oversized graphs before parsing variables or traversing node links', () => {
    const nodes = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        String(index),
        {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'portrait', clip: [String((index + 1) % 501), 0] }
        }
      ])
    )
    expect(() =>
      prepareWorkflow(
        { name: 'Oversized', source: { kind: 'api_json', content: JSON.stringify(nodes) } },
        catalog()
      )
    ).toThrow(/at most 500/)
  })

  it('builds a valid checkpoint recipe with inferred prompt and seed roles without executing', () => {
    const info = catalog()
    const before = JSON.stringify(info)
    const result = prepareWorkflow(recipe, info)
    expect(result.validation.valid).toBe(true)
    expect(result.batch_ready).toBe(true)
    expect(result.prepared.parsed.nodes['1'].inputs.ckpt_name).toBe('portrait.safetensors')
    expect(result.prepared.parsed.nodes['4'].inputs).toMatchObject({
      width: 768,
      height: 768,
      batch_size: 1
    })
    expect(result.prepared.parsed.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: '2', fieldName: 'text', role: 'prompt_positive' }),
        expect.objectContaining({ nodeId: '3', fieldName: 'text', role: 'prompt_negative' }),
        expect.objectContaining({ nodeId: '5', fieldName: 'seed', role: 'seed' })
      ])
    )
    expect(result.validation.warnings).toContainEqual(
      expect.objectContaining({ code: 'CHECKPOINT_ARCHITECTURE' })
    )
    expect(JSON.stringify(info)).toBe(before)
  })

  it('chains LoRA model and CLIP outputs while retaining the checkpoint VAE', () => {
    const result = prepareWorkflow(
      {
        ...recipe,
        source: {
          kind: 'checkpoint_text_to_image',
          loras: [
            { name: 'identity.safetensors', model_strength: 0.8, clip_strength: 0.6 },
            { name: 'style.safetensors' }
          ]
        }
      },
      catalog()
    )
    expect(result.validation.valid).toBe(true)
    const nodes = result.prepared.parsed.nodes
    expect(nodes['8'].inputs).toMatchObject({
      model: ['1', 0],
      clip: ['1', 1],
      strength_model: 0.8,
      strength_clip: 0.6
    })
    expect(nodes['9'].inputs).toMatchObject({ model: ['8', 0], clip: ['8', 1] })
    expect(nodes['5'].inputs.model).toEqual(['9', 0])
    expect(nodes['2'].inputs.clip).toEqual(['9', 1])
    expect(nodes['3'].inputs.clip).toEqual(['9', 1])
    expect(nodes['6'].inputs.vae).toEqual(['1', 2])
  })

  it('requires an explicit choice for ambiguous checkpoints and rejects unavailable choices', () => {
    const info = catalog()
    info.CheckpointLoaderSimple.input.required!.ckpt_name = [
      ['first.safetensors', 'second.safetensors']
    ]
    expect(() => prepareWorkflow(recipe, info)).toThrow(/Choose an installed/)
    expect(() =>
      prepareWorkflow(
        {
          ...recipe,
          source: { kind: 'checkpoint_text_to_image', checkpoint: 'missing.safetensors' }
        },
        info
      )
    ).toThrow(/Not installed/)
    expect(
      prepareWorkflow(
        {
          ...recipe,
          source: { kind: 'checkpoint_text_to_image', checkpoint: 'second.safetensors' }
        },
        info
      ).validation.valid
    ).toBe(true)
    expect(() =>
      prepareWorkflow(
        { ...recipe, source: { kind: 'checkpoint_text_to_image', sampler: '' } },
        catalog()
      )
    ).toThrow()
    expect(() =>
      prepareWorkflow(
        {
          ...recipe,
          source: { kind: 'checkpoint_text_to_image', loras: [{ name: 'missing.safetensors' }] }
        },
        catalog()
      )
    ).toThrow(/Not installed/)
  })

  it('patches existing primitive values but rejects graph rewiring, type changes and duplicates', () => {
    const valid = prepareWorkflow(
      { ...recipe, input_updates: [{ node_id: '5', field: 'cfg', value: 4.5 }] },
      catalog()
    )
    expect(valid.prepared.parsed.nodes['5'].inputs.cfg).toBe(4.5)
    for (const update of [
      { node_id: '5', field: 'model', value: 'replace link' },
      { node_id: '5', field: 'cfg', value: '4.5' },
      { node_id: '5', field: 'missing', value: 1 }
    ])
      expect(() => prepareWorkflow({ ...recipe, input_updates: [update] }, catalog())).toThrow()
    expect(() =>
      prepareWorkflow(
        {
          ...recipe,
          input_updates: [
            { node_id: '5', field: 'cfg', value: 4 },
            { node_id: '5', field: 'cfg', value: 8 }
          ]
        },
        catalog()
      )
    ).toThrow(/Duplicate/)
  })

  it('infers roles and persists variable defaults from the updated graph', () => {
    const graph = prepareWorkflow(recipe, catalog()).prepared.parsed.nodes
    graph['2']._meta = { title: 'Unconnected text' }
    graph['5'].inputs.positive = ['3', 0]
    const source = JSON.stringify(graph)
    const text = 'worst quality, low quality'
    const result = prepareWorkflow(
      {
        name: 'Updated text',
        source: { kind: 'api_json', content: source },
        input_updates: [{ node_id: '2', field: 'text', value: text }]
      },
      catalog()
    )

    expect(result.prepared.parsed.variables).toContainEqual(
      expect.objectContaining({
        nodeId: '2',
        fieldName: 'text',
        currentValue: text,
        role: 'prompt_negative'
      })
    )
    expect(JSON.parse(result.prepared.content)).toEqual(result.prepared.parsed.nodes)
    expect(JSON.parse(source)['2'].inputs.text).toBe('')
    expect(
      prepareWorkflow(
        { name: 'Updated text', source: { kind: 'api_json', content: result.prepared.content } },
        catalog()
      ).token
    ).toBe(result.token)

    const create = vi.fn(() => 'updated-workflow')
    const setVariables = vi.fn()
    persistPreparedWorkflowImport(result.prepared, { create, setVariables }, (operation) =>
      operation()
    )
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ api_json: result.prepared.content })
    )
    expect(setVariables).toHaveBeenCalledWith(
      'updated-workflow',
      expect.arrayContaining([
        expect.objectContaining({
          node_id: '2',
          field_name: 'text',
          default_val: text,
          role: 'prompt_negative'
        })
      ])
    )
  })

  it('rejects updates that expand a small source beyond the UTF-8 byte limit', () => {
    const graph = Object.fromEntries(
      Array.from({ length: 36 }, (_, index) => [
        String(index),
        { class_type: 'CustomText', inputs: { text: '' } }
      ])
    )
    expect(() =>
      prepareWorkflow(
        {
          name: 'Expanded graph',
          source: { kind: 'api_json', content: JSON.stringify(graph) },
          input_updates: Object.keys(graph).map((nodeId) => ({
            node_id: nodeId,
            field: 'text',
            value: '한'.repeat(100_000)
          }))
        },
        catalog()
      )
    ).toThrow('10MB')
  })

  it('keeps inferred variables and returned nodes consistent with JSON number normalization', () => {
    const content =
      '{"1":{"class_type":"CustomImage","inputs":{"value":1e400,"offset":-0}},' +
      '"2":{"class_type":"SaveImage","inputs":{"images":["1",0],"filename_prefix":"preview"}}}'
    const result = prepareWorkflow(
      { name: 'JSON numbers', source: { kind: 'api_json', content } },
      {
        ...catalog(),
        CustomImage: node({ value: ['*'], offset: ['FLOAT'] }, ['IMAGE'])
      }
    )
    expect(result.validation.valid).toBe(true)
    expect(result.prepared.parsed.nodes['1'].inputs).toEqual({ value: null, offset: 0 })
    expect(result.prepared.parsed.nodes).toEqual(JSON.parse(result.prepared.content))
    expect(result.prepared.parsed.variables.filter((variable) => variable.nodeId === '1')).toEqual([
      expect.objectContaining({ fieldName: 'offset', varType: 'number', currentValue: 0 })
    ])
  })

  it('preserves saved workflow roles and source data while persisting a clone', () => {
    const original = prepareWorkflow(recipe, catalog()).prepared
    const saved = {
      content: original.content,
      roles: [{ node_id: '2', field: 'text', role: 'fixed' }]
    }
    const before = JSON.stringify(saved)
    const result = prepareWorkflow(
      {
        name: 'Clone',
        source: { kind: 'saved_workflow', workflow_id: 'original' },
        roles: [{ node_id: '3', field: 'text', role: 'prompt_positive' }],
        input_updates: [{ node_id: '5', field: 'cfg', value: 3 }]
      },
      catalog(),
      saved
    )
    const records = new Map([['original', original.content]])
    const setVariables = vi.fn()
    const stored = persistPreparedWorkflowImport(
      result.prepared,
      {
        create: (data) => {
          records.set('clone', data.api_json)
          return 'clone'
        },
        setVariables
      },
      (operation) => operation()
    )
    expect(stored.id).toBe('clone')
    expect(records.get('original')).toBe(original.content)
    expect(JSON.stringify(saved)).toBe(before)
    expect(
      result.prepared.parsed.variables.find((v) => v.nodeId === '2' && v.fieldName === 'text')!.role
    ).toBe('fixed')
    expect(setVariables).toHaveBeenCalledWith(
      'clone',
      expect.arrayContaining([
        expect.objectContaining({ node_id: '3', field_name: 'text', role: 'prompt_positive' })
      ])
    )
  })

  it('requires valid primitive role targets and rejects invalid numeric seed roles', () => {
    expect(() =>
      prepareWorkflow(
        { ...recipe, roles: [{ node_id: '5', field: 'cfg', role: 'prompt_positive' }] },
        catalog()
      )
    ).toThrow(/text input/)
    expect(() =>
      prepareWorkflow(
        { ...recipe, roles: [{ node_id: '5', field: 'cfg', role: 'seed' }] },
        catalog()
      )
    ).toThrow(/seed/)
    const original = prepareWorkflow(recipe, catalog()).prepared.parsed.nodes
    original['8'] = { class_type: 'CustomSeed', inputs: { seed: 'text' } }
    expect(() =>
      prepareWorkflow(
        {
          name: 'Invalid seed',
          source: { kind: 'api_json', content: JSON.stringify(original) },
          roles: [{ node_id: '8', field: 'seed', role: 'seed' }]
        },
        { ...catalog(), CustomSeed: node({ seed: ['STRING'] }, []) }
      )
    ).toThrow(/numeric/)
    delete original['5'].inputs.cfg
    expect(() =>
      prepareWorkflow(
        {
          name: 'Missing primitive',
          source: { kind: 'api_json', content: JSON.stringify(original) },
          roles: [{ node_id: '5', field: 'cfg', role: 'custom' }]
        },
        catalog()
      )
    ).toThrow(/primitive/)
  })

  it('changes the preparation token for graph, roles or installed schema changes', () => {
    const initial = prepareWorkflow(recipe, catalog())
    expect(prepareWorkflow(recipe, catalog()).token).toBe(initial.token)
    expect(
      prepareWorkflow(
        { ...recipe, input_updates: [{ node_id: '5', field: 'cfg', value: 3 }] },
        catalog()
      ).token
    ).not.toBe(initial.token)
    expect(
      prepareWorkflow(
        { ...recipe, roles: [{ node_id: '2', field: 'text', role: 'fixed' }] },
        catalog()
      ).token
    ).not.toBe(initial.token)
    const changedInfo = catalog()
    changedInfo.KSampler.input.required!.steps = ['INT', { min: 1, max: 100 }]
    expect(prepareWorkflow(recipe, changedInfo).token).not.toBe(initial.token)
  })

  it('returns invalid graph findings for missing nodes and out-of-range patched values', () => {
    const info = catalog()
    delete info.VAEDecode
    const result = prepareWorkflow(recipe, info)
    expect(result.validation.valid).toBe(false)
    expect(result.validation.errors).toContainEqual(
      expect.objectContaining({ code: 'MISSING_NODE_TYPE', node_id: '6' })
    )
    const range = prepareWorkflow(
      { ...recipe, input_updates: [{ node_id: '5', field: 'steps', value: 500 }] },
      catalog()
    )
    expect(range.validation.valid).toBe(false)
    expect(range.validation.errors).toContainEqual(expect.objectContaining({ code: 'INPUT_MAX' }))
  })
})
