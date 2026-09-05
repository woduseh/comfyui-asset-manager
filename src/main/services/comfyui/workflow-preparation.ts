import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isJsonObject } from '@shared/safe-json'
import { MAX_WORKFLOW_FILE_SIZE_BYTES } from '../../constants'
import type { ComfyUINode, ComfyUIObjectInfo } from './types'
import { readWorkflowImportNodes, type PreparedWorkflowImport } from './workflow-import'
import { analyzeWorkflowNodes } from './workflow-parser'
import { validateWorkflowGraph } from './workflow-validation'

const scalar = z.union([z.string().max(100_000), z.number().finite(), z.boolean()])
const textId = z.string().min(1).max(200)
const role = z.enum(['prompt_positive', 'prompt_negative', 'seed', 'fixed', 'custom'])
export const workflowPreparationInput = {
  name: z.string().trim().min(1).max(200),
  source: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('checkpoint_text_to_image'),
      checkpoint: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Exact installed CheckpointLoaderSimple name. Omit only when exactly one is available. Use a compatible SD1/SD2/SDXL checkpoint; filenames do not prove architecture.'
        ),
      width: z.number().int().min(64).max(4096).multipleOf(8).default(768),
      height: z.number().int().min(64).max(4096).multipleOf(8).default(768),
      steps: z.number().int().min(1).max(150).default(24),
      cfg: z.number().min(0).max(30).default(7),
      sampler: z
        .string()
        .min(1)
        .optional()
        .describe('Installed KSampler enum; defaults to euler when available'),
      scheduler: z
        .string()
        .min(1)
        .optional()
        .describe('Installed KSampler enum; defaults to normal when available'),
      loras: z
        .array(
          z.object({
            name: textId,
            model_strength: z.number().min(-4).max(4).default(1),
            clip_strength: z.number().min(-4).max(4).default(1)
          })
        )
        .max(10)
        .default([])
    }),
    z.object({
      kind: z.literal('saved_workflow'),
      workflow_id: textId.describe(
        'Read and clone an existing workflow; original is never overwritten'
      )
    }),
    z.object({
      kind: z.literal('api_json'),
      content: z
        .string()
        .min(1)
        .max(MAX_WORKFLOW_FILE_SIZE_BYTES)
        .describe(
          'ComfyUI API node-map JSON, including custom model graphs authored from inspect_comfyui schemas'
        )
    })
  ]),
  input_updates: z
    .array(z.object({ node_id: textId, field: textId, value: scalar }))
    .max(500)
    .default([])
    .describe('Replace primitive inputs only. For graph rewiring provide source.kind=api_json.'),
  roles: z
    .array(z.object({ node_id: textId, field: textId, role }))
    .max(100)
    .default([])
    .describe(
      'Override inferred roles for custom encoders. Every mapping must target a discovered primitive variable.'
    )
}
const preparationSchema = z.object(workflowPreparationInput)
export type WorkflowPreparationInput = z.infer<typeof preparationSchema>

export interface SavedWorkflowSource {
  content: string
  roles: Array<{ node_id: string; field: string; role: string }>
}

function installedChoice(
  info: ComfyUIObjectInfo,
  node: string,
  field: string,
  requested?: string,
  preferred?: string
): string {
  const choices = info[node]?.input.required?.[field]?.[0]
  if (!Array.isArray(choices) || !choices.length)
    throw new Error(`No installed choices for ${node}.${field}; inspect_comfyui first`)
  if (requested !== undefined) {
    if (!choices.includes(requested))
      throw new Error(`Not installed: ${node}.${field}=${requested}`)
    return requested
  }
  if (preferred && choices.includes(preferred)) return preferred
  if (choices.length === 1 && typeof choices[0] === 'string') return choices[0]
  throw new Error(
    `Choose an installed ${node}.${field} with inspect_comfyui. Candidates: ${choices.slice(0, 20).join(', ')}`
  )
}

function checkpointGraph(
  source: Extract<WorkflowPreparationInput['source'], { kind: 'checkpoint_text_to_image' }>,
  info: ComfyUIObjectInfo
): Record<string, ComfyUINode> {
  const checkpoint = installedChoice(info, 'CheckpointLoaderSimple', 'ckpt_name', source.checkpoint)
  const sampler = installedChoice(info, 'KSampler', 'sampler_name', source.sampler, 'euler')
  const scheduler = installedChoice(info, 'KSampler', 'scheduler', source.scheduler, 'normal')
  const nodes: Record<string, ComfyUINode> = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['1', 1] },
      _meta: { title: 'Positive prompt' }
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['1', 1] },
      _meta: { title: 'Negative prompt' }
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: source.width, height: source.height, batch_size: 1 }
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: 0,
        steps: source.steps,
        cfg: source.cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1
      }
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'asset_manager' } }
  }
  let model: [string, number] = ['1', 0]
  let clip: [string, number] = ['1', 1]
  source.loras.forEach((lora, index) => {
    const name = installedChoice(info, 'LoraLoader', 'lora_name', lora.name)
    const nodeId = String(8 + index)
    nodes[nodeId] = {
      class_type: 'LoraLoader',
      inputs: {
        model,
        clip,
        lora_name: name,
        strength_model: lora.model_strength,
        strength_clip: lora.clip_strength
      }
    }
    model = [nodeId, 0]
    clip = [nodeId, 1]
  })
  nodes['5'].inputs.model = model
  nodes['2'].inputs.clip = clip
  nodes['3'].inputs.clip = clip
  return nodes
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (isJsonObject(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}

/** Build and validate using a live catalog, without execution, network writes or persistence. */
export function prepareWorkflow(
  raw: unknown,
  info: ComfyUIObjectInfo,
  saved?: SavedWorkflowSource
): {
  prepared: PreparedWorkflowImport
  validation: ReturnType<typeof validateWorkflowGraph>
  token: string
  batch_ready: boolean
} {
  const input = preparationSchema.parse(raw)
  let content: string
  if (input.source.kind === 'checkpoint_text_to_image')
    content = JSON.stringify(checkpointGraph(input.source, info))
  else if (input.source.kind === 'api_json') content = input.source.content
  else {
    if (!saved) throw new Error('Saved workflow not found')
    content = saved.content
  }
  let nodes = readWorkflowImportNodes(content)
  // Bound work before role inference traverses graph links.
  if (Object.keys(nodes).length > 500) {
    throw new Error('Workflow preparation supports at most 500 workflow nodes')
  }
  const updated = new Set<string>()
  for (const update of input.input_updates) {
    const key = `${update.node_id}:${update.field}`
    if (updated.has(key)) throw new Error(`Duplicate input update: ${key}`)
    updated.add(key)
    const original = nodes[update.node_id]?.inputs[update.field]
    if (original === undefined || original === null || typeof original === 'object')
      throw new Error(`Update must target an existing primitive input: ${key}`)
    if (typeof original !== typeof update.value)
      throw new Error(`Input type must remain ${typeof original}: ${key}`)
    nodes[update.node_id].inputs[update.field] = update.value
  }
  content = JSON.stringify(nodes)
  // Re-read the stored JSON to enforce the final byte limit and its number normalization.
  nodes = readWorkflowImportNodes(content)
  const parsed = analyzeWorkflowNodes(nodes, input.name)
  const prepared: PreparedWorkflowImport = {
    content,
    parsed,
    category: parsed.suggestedCategory,
    description: 'Prepared against installed ComfyUI node schemas'
  }
  const applyRole = (mapping: { node_id: string; field: string; role: string }): void => {
    const key = `${mapping.node_id}:${mapping.field}`
    const variable = prepared.parsed.variables.find(
      (v) => v.nodeId === mapping.node_id && v.fieldName === mapping.field
    )
    if (!variable || !['string', 'number', 'boolean'].includes(typeof variable.currentValue))
      throw new Error(`Role must target a discovered primitive variable: ${key}`)
    if (mapping.role.startsWith('prompt_') && typeof variable.currentValue !== 'string')
      throw new Error(`Prompt role requires a text input: ${key}`)
    if (
      mapping.role === 'seed' &&
      (!['seed', 'noise_seed'].includes(mapping.field) || typeof variable.currentValue !== 'number')
    )
      throw new Error('Automatic seed injection supports numeric seed/noise_seed fields only')
    variable.role = mapping.role
  }
  for (const mapping of input.source.kind === 'saved_workflow' ? (saved?.roles ?? []) : []) {
    const variable = prepared.parsed.variables.find(
      (v) => v.nodeId === mapping.node_id && v.fieldName === mapping.field
    )
    const replaced = input.roles.some(
      (replacement) =>
        replacement.node_id === mapping.node_id && replacement.field === mapping.field
    )
    if (variable && role.safeParse(mapping.role).success && !replaced) applyRole(mapping)
  }
  const mapped = new Set<string>()
  for (const mapping of input.roles) {
    const key = `${mapping.node_id}:${mapping.field}`
    if (mapped.has(key)) throw new Error(`Duplicate role mapping: ${key}`)
    mapped.add(key)
    applyRole(mapping)
  }
  const validation = validateWorkflowGraph(nodes, info)
  const batchReady = prepared.parsed.variables.some((v) => v.role === 'prompt_positive')
  if (!batchReady)
    validation.warnings.push({
      code: 'NO_POSITIVE_SLOT',
      message:
        'No positive prompt slot was detected. Set roles before using this workflow for a prompt-module batch.'
    })
  if (input.source.kind === 'checkpoint_text_to_image')
    validation.warnings.push({
      code: 'CHECKPOINT_ARCHITECTURE',
      message:
        'The standard checkpoint recipe targets SD1/SD2/SDXL-style model+CLIP+VAE checkpoints. Installed filenames do not prove architecture, LoRA compatibility or available VRAM. Other model families require their own API graph.'
    })
  const usedInfo = Object.fromEntries(
    [...new Set(Object.values(nodes).map((node) => node.class_type))].map((type) => [
      type,
      info[type]
    ])
  )
  const token = createHash('sha256')
    .update(JSON.stringify(canonical({ prepared, usedInfo })))
    .digest('hex')
  return { prepared, validation, token, batch_ready: batchReady }
}
