import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { BatchConfig } from '@shared/ipc-contract'
import { parseWorkflow, type ParsedWorkflow } from '../../comfyui/workflow-parser'
import { batchJobService, type PreparedBatchJob } from '../../batch/batch-job-service'
import { moduleRepo, moduleItemRepo, workflowRepo } from './shared'
import { validatePromptVariants } from '../../../ipc/validators'

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/)
const text = z.string().max(100_000)

export const batchInput = {
  name: z.string().trim().min(1).max(200).describe('Job name, for example Alice emotions'),
  description: z.string().max(10_000).optional(),
  workflow_id: id.describe('ID from list_workflows/get_workflow'),
  module_selections: z
    .array(
      z.object({
        moduleId: id,
        moduleType: z
          .string()
          .optional()
          .describe('Optional legacy field; inferred from the module'),
        selectedItemIds: z
          .array(id)
          .min(1)
          .max(1000)
          .optional()
          .describe('Omit to select all enabled items')
      })
    )
    .min(1)
    .max(100),
  count_per_combination: z.number().int().min(1).max(10_000).default(1),
  seed_mode: z.enum(['random', 'fixed', 'incremental']).default('random'),
  fixed_seed: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1_000_000)
    .optional(),
  output_folder_pattern: z.string().max(1000).default('{job}/{character}/{emotion}'),
  file_name_pattern: z.string().max(1000).default('{character}_{emotion}_{index}'),
  slot_mappings: z
    .array(
      z.object({
        variableId: id.describe(
          'Prompt variable ID from get_workflow; node/field/role are inferred'
        ),
        nodeId: z.string().optional().describe('Legacy field; must match the variable if provided'),
        fieldName: z
          .string()
          .optional()
          .describe('Legacy field; must match the variable if provided'),
        role: z.enum(['prompt_positive', 'prompt_negative']).optional(),
        action: z.enum(['inject', 'fixed']).default('inject'),
        fixedValue: text.optional(),
        assignedModuleIds: z.array(id).max(100).optional(),
        prefixModuleIds: z.array(id).max(100).optional(),
        prefixText: text.optional(),
        suffixText: text.optional(),
        promptVariant: z
          .string()
          .max(200)
          .optional()
          .describe('Exact variant name; all assigned items must have it')
      })
    )
    .min(1)
    .max(100)
    .optional()
    .describe('Omit to inject all selected modules into detected positive/negative slots'),
  variable_overrides: z
    .array(
      z.object({
        variableId: id.describe('Non-prompt/non-seed variable ID from get_workflow'),
        value: z.string().max(10_000)
      })
    )
    .max(500)
    .optional()
}

const batchSchema = z.object(batchInput)
export type BatchInput = z.infer<typeof batchSchema>

export function workflowDetails(workflowId: string): {
  workflow: Record<string, unknown>
  variables: Record<string, unknown>[]
  nodes: ParsedWorkflow['nodes']
} {
  const workflow = workflowRepo.get(workflowId)
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)
  const parsed = parseWorkflow(workflow.api_json as string)
  const stored = workflowRepo.getVariables(workflowId)
  // Legacy workflows without persisted variable rows remain discoverable without DB writes.
  const variables = stored.length
    ? stored
    : parsed.variables.map((variable, index) => ({
        id: `derived_${index}`,
        node_id: variable.nodeId,
        field_name: variable.fieldName,
        role: variable.role,
        var_type: variable.varType,
        display_name: variable.displayName,
        default_val: String(variable.currentValue ?? '')
      }))
  return { workflow, variables, nodes: parsed.nodes }
}

export function resolveBatchInput(raw: unknown): BatchConfig {
  const input = batchSchema.parse(raw)
  const { variables, nodes } = workflowDetails(input.workflow_id)
  const selections = input.module_selections.map((selection) => {
    const module = moduleRepo.get(selection.moduleId)
    if (!module) throw new Error(`Module not found: ${selection.moduleId}`)
    if (selection.moduleType && selection.moduleType !== module.type)
      throw new Error(`Module type does not match ${selection.moduleId}`)
    const items = moduleItemRepo.list(selection.moduleId)
    const selected =
      selection.selectedItemIds ??
      items.filter((item) => item.enabled !== 0).map((item) => String(item.id))
    if (!selected.length)
      throw new Error(`Module has no enabled selected items: ${selection.moduleId}`)
    if (new Set(selected).size !== selected.length) throw new Error('Duplicate selected item IDs')
    for (const selectedId of selected) {
      const item = items.find((item) => item.id === selectedId)
      if (!item || item.enabled === 0)
        throw new Error(`Item is missing, disabled, or belongs to another module: ${selectedId}`)
    }
    return {
      moduleId: selection.moduleId,
      moduleType: String(module.type),
      selectedItemIds: selected
    }
  })
  if (new Set(selections.map((s) => s.moduleId)).size !== selections.length)
    throw new Error('Select each module once; put multiple item IDs in its selection')
  const selectedModuleIds = selections.map((s) => s.moduleId)
  const promptVariables = variables.filter(
    (v) => v.role === 'prompt_positive' || v.role === 'prompt_negative'
  )
  const requestedSlots: NonNullable<BatchInput['slot_mappings']> =
    input.slot_mappings ??
    promptVariables.map((variable) => ({
      variableId: String(variable.id),
      action: 'inject' as const
    }))
  if (!requestedSlots.length)
    throw new Error(
      'Workflow has no detected prompt slots. Configure prompt variable roles in the app first.'
    )
  if (new Set(requestedSlots.map((s) => s.variableId)).size !== requestedSlots.length)
    throw new Error('Duplicate slot variable IDs')
  const missingSlots = promptVariables.filter(
    (variable) => !requestedSlots.some((slot) => slot.variableId === variable.id)
  )
  if (missingSlots.length)
    throw new Error(
      `Map every detected prompt slot, including ${missingSlots.map((v) => v.id).join(', ')}. Use action=fixed to preserve a slot explicitly.`
    )
  const findVariable = (variableId: string): Record<string, unknown> => {
    const variable = variables.find((v) => v.id === variableId)
    if (!variable)
      throw new Error(`Unknown workflow variable: ${variableId}; call get_workflow again`)
    const value = nodes[String(variable.node_id)]?.inputs[String(variable.field_name)]
    if (!['string', 'number', 'boolean'].includes(typeof value))
      throw new Error(`Variable is not a primitive workflow input: ${variableId}`)
    return variable
  }
  const slots = requestedSlots.map((slot) => {
    const variable = findVariable(slot.variableId)
    if (variable.role !== 'prompt_positive' && variable.role !== 'prompt_negative')
      throw new Error(`Variable is not a prompt slot: ${slot.variableId}`)
    if (typeof nodes[String(variable.node_id)].inputs[String(variable.field_name)] !== 'string')
      throw new Error(`Prompt slot requires a text input: ${slot.variableId}`)
    if (
      (slot.nodeId && slot.nodeId !== variable.node_id) ||
      (slot.fieldName && slot.fieldName !== variable.field_name) ||
      (slot.role && slot.role !== variable.role)
    )
      throw new Error('Slot metadata does not match the workflow variable')
    if (slot.action === 'fixed' && slot.fixedValue === undefined)
      throw new Error('Fixed slots require fixedValue')
    const assigned = slot.assignedModuleIds?.length ? slot.assignedModuleIds : selectedModuleIds
    if (assigned.some((moduleId) => !selectedModuleIds.includes(moduleId)))
      throw new Error('Slot assigned modules must be included in module_selections')
    for (const moduleId of slot.prefixModuleIds ?? []) {
      if (!moduleRepo.get(moduleId)) throw new Error(`Prefix module not found: ${moduleId}`)
    }
    if (slot.promptVariant && slot.action === 'inject') {
      for (const moduleId of new Set([...assigned, ...(slot.prefixModuleIds ?? [])])) {
        const selection = selections.find((s) => s.moduleId === moduleId)
        const isPrefix = slot.prefixModuleIds?.includes(moduleId)
        const items = moduleItemRepo
          .list(moduleId)
          .filter(
            (item) =>
              item.enabled !== 0 &&
              (isPrefix || !selection || selection.selectedItemIds.includes(String(item.id)))
          )
        if (
          items.some((item) => !validatePromptVariants(item.prompt_variants)[slot.promptVariant!])
        )
          throw new Error(`Missing prompt variant ${slot.promptVariant} in module ${moduleId}`)
      }
    }
    return {
      variableId: slot.variableId,
      nodeId: String(variable.node_id),
      fieldName: String(variable.field_name),
      role: String(variable.role),
      action: slot.action,
      fixedValue: slot.fixedValue ?? '',
      assignedModuleIds: assigned,
      prefixModuleIds: slot.prefixModuleIds ?? [],
      prefixText: slot.prefixText ?? '',
      suffixText: slot.suffixText ?? '',
      promptVariant: slot.promptVariant
    }
  })
  if (!slots.some((slot) => slot.role === 'prompt_positive' && slot.action === 'inject'))
    throw new Error('At least one positive prompt slot must inject the selected modules')
  if (
    input.variable_overrides &&
    new Set(input.variable_overrides.map((override) => override.variableId)).size !==
      input.variable_overrides.length
  )
    throw new Error('Duplicate variable overrides')
  const overrides = input.variable_overrides?.map((override) => {
    const variable = findVariable(override.variableId)
    if (
      variable.role === 'prompt_positive' ||
      variable.role === 'prompt_negative' ||
      variable.role === 'seed'
    )
      throw new Error('Use slot_mappings or seed_mode for prompt and seed variables')
    const currentValue = nodes[String(variable.node_id)].inputs[String(variable.field_name)]
    if (
      typeof currentValue === 'number' &&
      (!override.value.trim() || !Number.isFinite(Number(override.value)))
    )
      throw new Error(`Variable requires a finite number: ${override.variableId}`)
    if (typeof currentValue === 'boolean' && !['true', 'false'].includes(override.value))
      throw new Error(`Variable requires true or false: ${override.variableId}`)
    return {
      nodeId: String(variable.node_id),
      fieldName: String(variable.field_name),
      value: override.value
    }
  })
  return {
    name: input.name,
    description: input.description,
    workflowId: input.workflow_id,
    moduleSelections: selections,
    countPerCombination: input.count_per_combination,
    seedMode: input.seed_mode,
    fixedSeed: input.fixed_seed,
    outputFolderPattern: input.output_folder_pattern,
    fileNamePattern: input.file_name_pattern,
    slotMappings: slots,
    variableOverrides: overrides
  }
}

export function prepareBatchInput(raw: unknown): {
  config: BatchConfig
  prepared: PreparedBatchJob
  previewToken: string
} {
  const config = resolveBatchInput(raw)
  const prepared = batchJobService.prepare(config)
  const workflow = workflowRepo.get(config.workflowId)!
  const previewToken = createHash('sha256')
    .update(JSON.stringify({ data: prepared.data, workflow: workflow.api_json }))
    .digest('hex')
  return { config, prepared, previewToken }
}
