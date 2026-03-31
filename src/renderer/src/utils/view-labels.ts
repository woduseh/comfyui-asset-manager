type Translate = (key: string, params?: Record<string, unknown>) => string

interface WorkflowLike {
  id: string
  name: string
  category: string
}

export function buildWorkflowCategoryOptions(
  t: Translate
): Array<{ label: string; value: string }> {
  return [
    { label: t('workflow.category.generation'), value: 'generation' },
    { label: t('workflow.category.upscale'), value: 'upscale' },
    { label: t('workflow.category.detailer'), value: 'detailer' },
    { label: t('workflow.category.custom'), value: 'custom' }
  ]
}

export function buildWorkflowRoleOptions(t: Translate): Array<{ label: string; value: string }> {
  return [
    { label: t('workflow.role.promptPositive'), value: 'prompt_positive' },
    { label: t('workflow.role.promptNegative'), value: 'prompt_negative' },
    { label: t('workflow.role.seed'), value: 'seed' },
    { label: t('workflow.role.fixed'), value: 'fixed' },
    { label: t('workflow.role.custom'), value: 'custom' }
  ]
}

export function buildWorkflowRoleLabels(t: Translate): Record<string, string> {
  return {
    prompt_positive: t('workflow.roleShort.promptPositive'),
    prompt_negative: t('workflow.roleShort.promptNegative'),
    seed: t('workflow.roleShort.seed'),
    fixed: t('workflow.roleShort.fixed'),
    custom: t('workflow.roleShort.custom')
  }
}

export function buildWorkflowVarTypeLabels(t: Translate): Record<string, string> {
  return {
    text: t('workflow.varType.text'),
    number: t('workflow.varType.number'),
    boolean: t('workflow.varType.boolean'),
    seed: t('workflow.varType.seed'),
    image: t('workflow.varType.image'),
    model: t('workflow.varType.model'),
    lora: t('workflow.varType.lora')
  }
}

export function buildBatchSeedModeOptions(t: Translate): Array<{ label: string; value: string }> {
  return [
    { label: t('batch.seedMode.random'), value: 'random' },
    { label: t('batch.seedMode.fixed'), value: 'fixed' },
    { label: t('batch.seedMode.incremental'), value: 'incremental' }
  ]
}

export function buildBatchStatusLabels(t: Translate): Record<string, string> {
  return {
    draft: t('jobs.statusLabel.draft'),
    queued: t('jobs.statusLabel.queued'),
    running: t('jobs.statusLabel.running'),
    paused: t('jobs.statusLabel.paused'),
    completed: t('jobs.statusLabel.completed'),
    failed: t('jobs.statusLabel.failed'),
    cancelled: t('jobs.statusLabel.cancelled')
  }
}

export function buildGallerySortOptions(t: Translate): Array<{ label: string; value: string }> {
  return [
    { label: t('gallery.sortOptions.createdDesc'), value: 'created_at:desc' },
    { label: t('gallery.sortOptions.createdAsc'), value: 'created_at:asc' },
    { label: t('gallery.sortOptions.ratingDesc'), value: 'rating:desc' },
    { label: t('gallery.sortOptions.ratingAsc'), value: 'rating:asc' }
  ]
}

export function buildGalleryRatingOptions(
  t: Translate
): Array<{ label: string; value: number | null }> {
  return [
    { label: t('gallery.all'), value: null },
    { label: '⭐ 1+', value: 1 },
    { label: '⭐⭐ 2+', value: 2 },
    { label: '⭐⭐⭐ 3+', value: 3 },
    { label: '⭐⭐⭐⭐ 4+', value: 4 },
    { label: '⭐⭐⭐⭐⭐ 5', value: 5 }
  ]
}

export function buildModulePromptPreviewLabels(t: Translate): {
  positive: string
  negative: string
} {
  return {
    positive: t('module.promptPreviewPositive'),
    negative: t('module.promptPreviewNegative')
  }
}

export function buildSettingsThemeOptions(t: Translate): Array<{ label: string; value: string }> {
  return [
    { label: t('settings.general.dark'), value: 'dark' },
    { label: t('settings.general.light'), value: 'light' }
  ]
}

export function getGenerationWorkflowHint(workflows: WorkflowLike[], t: Translate): string | null {
  const generationCount = workflows.filter((workflow) => workflow.category === 'generation').length
  const hiddenCount = workflows.length - generationCount

  if (workflows.length === 0 || hiddenCount === 0) {
    return null
  }

  if (generationCount === 0) {
    return t('batch.wizard.noGenerationWorkflowsHint')
  }

  return t('batch.wizard.generationOnlyHint', { count: hiddenCount })
}
