import { describe, expect, it } from 'vitest'
import { getGenerationWorkflowHint } from '../../src/renderer/src/utils/view-labels'

function t(key: string, params?: Record<string, unknown>): string {
  return params ? `${key}:${JSON.stringify(params)}` : key
}

describe('getGenerationWorkflowHint', () => {
  it('returns a generation-only hint when non-generation workflows are hidden', () => {
    expect(
      getGenerationWorkflowHint(
        [
          { id: 'wf-1', name: 'Gen', category: 'generation' },
          { id: 'wf-2', name: 'Upscale', category: 'upscale' }
        ],
        t
      )
    ).toBe('batch.wizard.generationOnlyHint:{"count":1}')
  })

  it('returns a no-generation hint when no eligible workflows exist', () => {
    expect(
      getGenerationWorkflowHint([{ id: 'wf-1', name: 'Upscale', category: 'upscale' }], t)
    ).toBe('batch.wizard.noGenerationWorkflowsHint')
  })

  it('returns null when all workflows are generation or there are no workflows', () => {
    expect(getGenerationWorkflowHint([], t)).toBeNull()
    expect(
      getGenerationWorkflowHint([{ id: 'wf-1', name: 'Gen', category: 'generation' }], t)
    ).toBeNull()
  })
})
