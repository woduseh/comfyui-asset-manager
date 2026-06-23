import { describe, expect, it } from 'vitest'
import { groupWorkflowVariables } from '../../src/renderer/src/utils/workflow-variable-groups'

describe('groupWorkflowVariables', () => {
  it('groups variables in the intended role order', () => {
    const groups = groupWorkflowVariables([
      { id: 'custom', role: 'custom' },
      { id: 'seed', role: 'seed' },
      { id: 'positive', role: 'prompt_positive' },
      { id: 'fixed', role: 'fixed' },
      { id: 'negative', role: 'prompt_negative' }
    ])

    expect(groups.map((group) => group.role)).toEqual([
      'prompt_positive',
      'prompt_negative',
      'seed',
      'fixed',
      'custom'
    ])
  })

  it('places missing and unknown roles in the custom group and omits empty groups', () => {
    const groups = groupWorkflowVariables([{ id: 'missing' }, { id: 'unknown', role: 'other' }])

    expect(groups).toEqual([
      {
        role: 'custom',
        variables: [{ id: 'missing' }, { id: 'unknown', role: 'other' }]
      }
    ])
  })
})
