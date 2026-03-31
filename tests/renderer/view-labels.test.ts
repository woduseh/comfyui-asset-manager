import { describe, expect, it } from 'vitest'
import {
  buildBatchSeedModeOptions,
  buildBatchStatusLabels,
  buildGalleryRatingOptions,
  buildGallerySortOptions,
  buildModulePromptPreviewLabels,
  buildSettingsThemeOptions,
  buildWorkflowCategoryOptions,
  buildWorkflowRoleLabels,
  buildWorkflowRoleOptions,
  buildWorkflowVarTypeLabels,
  getGenerationWorkflowHint
} from '../../src/renderer/src/utils/view-labels'

function t(key: string, params?: Record<string, unknown>): string {
  return params ? `${key}:${JSON.stringify(params)}` : key
}

describe('view-label helpers', () => {
  it('builds workflow labels through the translator', () => {
    expect(buildWorkflowCategoryOptions(t)).toEqual([
      { label: 'workflow.category.generation', value: 'generation' },
      { label: 'workflow.category.upscale', value: 'upscale' },
      { label: 'workflow.category.detailer', value: 'detailer' },
      { label: 'workflow.category.custom', value: 'custom' }
    ])

    expect(buildWorkflowRoleOptions(t)).toEqual([
      { label: 'workflow.role.promptPositive', value: 'prompt_positive' },
      { label: 'workflow.role.promptNegative', value: 'prompt_negative' },
      { label: 'workflow.role.seed', value: 'seed' },
      { label: 'workflow.role.fixed', value: 'fixed' },
      { label: 'workflow.role.custom', value: 'custom' }
    ])

    expect(buildWorkflowRoleLabels(t)).toEqual({
      prompt_positive: 'workflow.roleShort.promptPositive',
      prompt_negative: 'workflow.roleShort.promptNegative',
      seed: 'workflow.roleShort.seed',
      fixed: 'workflow.roleShort.fixed',
      custom: 'workflow.roleShort.custom'
    })

    expect(buildWorkflowVarTypeLabels(t)).toEqual({
      text: 'workflow.varType.text',
      number: 'workflow.varType.number',
      boolean: 'workflow.varType.boolean',
      seed: 'workflow.varType.seed',
      image: 'workflow.varType.image',
      model: 'workflow.varType.model',
      lora: 'workflow.varType.lora'
    })
  })

  it('builds batch and module labels through the translator', () => {
    expect(buildBatchSeedModeOptions(t)).toEqual([
      { label: 'batch.seedMode.random', value: 'random' },
      { label: 'batch.seedMode.fixed', value: 'fixed' },
      { label: 'batch.seedMode.incremental', value: 'incremental' }
    ])

    expect(buildBatchStatusLabels(t)).toEqual({
      draft: 'jobs.statusLabel.draft',
      queued: 'jobs.statusLabel.queued',
      running: 'jobs.statusLabel.running',
      paused: 'jobs.statusLabel.paused',
      completed: 'jobs.statusLabel.completed',
      failed: 'jobs.statusLabel.failed',
      cancelled: 'jobs.statusLabel.cancelled'
    })

    expect(buildModulePromptPreviewLabels(t)).toEqual({
      positive: 'module.promptPreviewPositive',
      negative: 'module.promptPreviewNegative'
    })
  })

  it('builds gallery filter labels through the translator', () => {
    expect(buildGallerySortOptions(t)).toEqual([
      { label: 'gallery.sortOptions.createdDesc', value: 'created_at:desc' },
      { label: 'gallery.sortOptions.createdAsc', value: 'created_at:asc' },
      { label: 'gallery.sortOptions.ratingDesc', value: 'rating:desc' },
      { label: 'gallery.sortOptions.ratingAsc', value: 'rating:asc' }
    ])

    expect(buildGalleryRatingOptions(t)).toEqual([
      { label: 'gallery.all', value: null },
      { label: '⭐ 1+', value: 1 },
      { label: '⭐⭐ 2+', value: 2 },
      { label: '⭐⭐⭐ 3+', value: 3 },
      { label: '⭐⭐⭐⭐ 4+', value: 4 },
      { label: '⭐⭐⭐⭐⭐ 5', value: 5 }
    ])
  })

  it('builds settings theme labels through the translator', () => {
    expect(buildSettingsThemeOptions(t)).toEqual([
      { label: 'settings.general.dark', value: 'dark' },
      { label: 'settings.general.light', value: 'light' }
    ])
  })

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
