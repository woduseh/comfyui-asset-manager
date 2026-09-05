import { describe, expect, it } from 'vitest'
import { injectPromptData } from '../../../../src/main/services/batch/prompt-injection'

describe('injectPromptData', () => {
  it('injects slot prompts, fixed values, and sampler seeds', () => {
    const workflow = {
      '1': { inputs: { text: '' } },
      '2': { inputs: { text: '' } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, noise_seed: 0 } }
    }

    injectPromptData(workflow, {
      positive: 'global positive',
      negative: 'global negative',
      seed: 42,
      extraVariables: {},
      slotMappings: [
        {
          nodeId: '1',
          fieldName: 'text',
          role: 'prompt_positive',
          action: 'inject',
          fixedValue: '',
          assignedModuleIds: [],
          prefixModuleIds: [],
          prefixText: '',
          suffixText: ''
        },
        {
          nodeId: '2',
          fieldName: 'text',
          role: 'prompt_negative',
          action: 'fixed',
          fixedValue: 'fixed negative',
          assignedModuleIds: [],
          prefixModuleIds: [],
          prefixText: '',
          suffixText: ''
        }
      ],
      slotPrompts: { '1:text': 'slot positive' }
    })

    expect(workflow['1'].inputs.text).toBe('slot positive')
    expect(workflow['2'].inputs.text).toBe('fixed negative')
    expect(workflow['3'].inputs).toMatchObject({ seed: 42, noise_seed: 42 })
  })

  it('preserves legacy prompt heuristics and applies overrides', () => {
    const workflow = {
      positive: { class_type: 'CLIPTextEncode', inputs: { text: 'portrait' } },
      negative: { class_type: 'CLIPTextEncode', inputs: { text: 'worst quality' } },
      sampler: { class_type: 'KSamplerAdvanced', inputs: { seed: 0, steps: 20 } }
    }

    injectPromptData(workflow, {
      positive: 'new positive',
      negative: 'new negative',
      seed: 7,
      variableOverrides: [{ nodeId: 'sampler', fieldName: 'steps', value: '30' }],
      extraVariables: { steps: 35 }
    })

    expect(workflow.positive.inputs.text).toBe('new positive')
    expect(workflow.negative.inputs.text).toBe('new negative')
    expect(workflow.sampler.inputs).toMatchObject({ seed: 7, steps: 35 })
  })

  it('preserves workflow primitive types for overrides and skips absent targets and links', () => {
    const workflow = {
      custom: { inputs: { amount: 1, active: true, text: 'old', link: ['source', 0] } }
    }
    injectPromptData(workflow, {
      positive: '',
      negative: '',
      seed: 1,
      extraVariables: {},
      variableOverrides: [
        { nodeId: 'custom', fieldName: 'amount', value: '2.5' },
        { nodeId: 'custom', fieldName: 'active', value: 'false' },
        { nodeId: 'custom', fieldName: 'text', value: '123' },
        { nodeId: 'missing', fieldName: 'amount', value: '3' },
        { nodeId: 'custom', fieldName: 'missing', value: '3' },
        { nodeId: 'custom', fieldName: 'link', value: '3' }
      ]
    })
    expect(workflow.custom.inputs).toEqual({
      amount: 2.5,
      active: false,
      text: '123',
      link: ['source', 0]
    })
  })

  it.each(['not-a-number', 'Infinity', '-Infinity', 'NaN', '', ' '])(
    'rejects invalid numeric overrides: %j',
    (value) => {
      const workflow = { custom: { inputs: { amount: 1 } } }
      expect(() =>
        injectPromptData(workflow, {
          positive: '',
          negative: '',
          seed: 1,
          extraVariables: {},
          variableOverrides: [{ nodeId: 'custom', fieldName: 'amount', value }]
        })
      ).toThrow('finite number')
      expect(workflow.custom.inputs.amount).toBe(1)
    }
  )

  it('rejects invalid boolean override text', () => {
    const workflow = { custom: { inputs: { active: false } } }
    expect(() =>
      injectPromptData(workflow, {
        positive: '',
        negative: '',
        seed: 1,
        extraVariables: {},
        variableOverrides: [{ nodeId: 'custom', fieldName: 'active', value: '1' }]
      })
    ).toThrow('true or false')
    expect(workflow.custom.inputs.active).toBe(false)
  })

  it('preserves an intentionally empty slot prompt instead of using the global prompt', () => {
    const workflow = { positive: { inputs: { text: 'old' } } }
    injectPromptData(workflow, {
      positive: 'global positive',
      negative: 'global negative',
      seed: 1,
      extraVariables: {},
      slotMappings: [
        {
          nodeId: 'positive',
          fieldName: 'text',
          role: 'prompt_positive',
          action: 'inject',
          fixedValue: '',
          assignedModuleIds: [],
          prefixModuleIds: [],
          prefixText: '',
          suffixText: ''
        }
      ],
      slotPrompts: { 'positive:text': '' }
    })
    expect(workflow.positive.inputs.text).toBe('')
  })

  it('injects seeds into custom workflows while preserving nonnumeric seed inputs', () => {
    const workflow = {
      noise: { class_type: 'RandomNoise', inputs: { noise_seed: 0 } },
      custom: { class_type: 'CustomSampler', inputs: { seed: 1, noise_seed: 2 } },
      links: { inputs: { seed: ['source', 0], noise_seed: 'external seed' } }
    }
    injectPromptData(workflow, { positive: '', negative: '', seed: 123, extraVariables: {} })
    expect(workflow.noise.inputs.noise_seed).toBe(123)
    expect(workflow.custom.inputs).toEqual({ seed: 123, noise_seed: 123 })
    expect(workflow.links.inputs).toEqual({ seed: ['source', 0], noise_seed: 'external seed' })
  })
})
