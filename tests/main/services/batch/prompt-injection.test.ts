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
})
