import { VARIABLE_NODE_TYPES, type ComfyUINode } from './types'
import { isJsonObject, safeJsonParse } from '../../utils/safe-json'

export interface ParsedVariable {
  nodeId: string
  nodeTitle: string
  nodeType: string
  fieldName: string
  displayName: string
  varType: string
  currentValue: unknown
  role: string
}

export interface ParsedWorkflow {
  name: string
  nodes: Record<string, ComfyUINode>
  variables: ParsedVariable[]
  suggestedCategory: 'generation' | 'upscale' | 'detailer' | 'custom'
}

/**
 * Parse a ComfyUI API-format workflow JSON and extract configurable variables.
 */
export function parseWorkflow(apiJson: string, name?: string): ParsedWorkflow {
  const nodes = parseWorkflowNodes(apiJson)
  const variables: ParsedVariable[] = []

  for (const [nodeId, node] of Object.entries(nodes)) {
    const nodeType = node.class_type
    const nodeTitle = node._meta?.title || `${nodeType} #${nodeId}`
    const knownType = VARIABLE_NODE_TYPES[nodeType]

    if (knownType) {
      for (const fieldDef of knownType.fields) {
        const currentValue = node.inputs[fieldDef.name]
        // Skip inputs that are links to other nodes (arrays like [nodeId, outputIndex])
        if (Array.isArray(currentValue)) continue

        variables.push({
          nodeId,
          nodeTitle,
          nodeType,
          fieldName: fieldDef.name,
          displayName: `${nodeTitle} - ${fieldDef.displayName}`,
          varType: fieldDef.type,
          currentValue,
          role: detectRole(nodeId, node, fieldDef.name, fieldDef.type, nodes)
        })
      }
    } else {
      // For unknown node types, extract primitive inputs (not node links)
      for (const [fieldName, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value)) continue // Skip node links

        const varType = inferVarType(fieldName, value)
        if (varType) {
          variables.push({
            nodeId,
            nodeTitle,
            nodeType,
            fieldName,
            displayName: `${nodeTitle} - ${fieldName}`,
            varType,
            currentValue: value,
            role: detectRole(nodeId, node, fieldName, varType, nodes)
          })
        }
      }
    }
  }

  const suggestedCategory = detectCategory(nodes)

  return {
    name: name || 'Imported Workflow',
    nodes,
    variables,
    suggestedCategory
  }
}

/**
 * Infer variable type from field name and value.
 */
function inferVarType(fieldName: string, value: unknown): string | null {
  const name = fieldName.toLowerCase()

  if (name.includes('seed')) return 'seed'
  if (name.includes('text') || name.includes('prompt')) return 'text'
  if (name.includes('ckpt') || name.includes('checkpoint') || name.includes('model_name'))
    return 'model'
  if (name.includes('lora')) return 'lora'
  if (name.includes('image') && typeof value === 'string') return 'image'

  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'text'

  return null
}

/**
 * Detect the workflow category based on its node composition.
 */
function detectCategory(
  nodes: Record<string, ComfyUINode>
): 'generation' | 'upscale' | 'detailer' | 'custom' {
  const nodeTypes = new Set(Object.values(nodes).map((n) => n.class_type))

  // Upscale detection
  const upscaleIndicators = [
    'UpscaleModelLoader',
    'ImageUpscaleWithModel',
    'LatentUpscale',
    'ImageScaleBy',
    'ImageScale'
  ]
  if (upscaleIndicators.some((t) => nodeTypes.has(t))) {
    // If it also has a sampler, it might be a generation+upscale pipeline
    const hasSampler = nodeTypes.has('KSampler') || nodeTypes.has('KSamplerAdvanced')
    const hasEmptyLatent = nodeTypes.has('EmptyLatentImage')
    if (!hasSampler || !hasEmptyLatent) {
      return 'upscale'
    }
  }

  // Detailer detection
  const detailerIndicators = [
    'FaceDetailer',
    'DetailerForEach',
    'DetailerForEachDebug',
    'DetailerForEachPipe',
    'UltralyticsDetectorProvider',
    'SAMLoader'
  ]
  if (detailerIndicators.some((t) => nodeTypes.has(t))) {
    return 'detailer'
  }

  // Generation detection
  const generationIndicators = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom']
  if (generationIndicators.some((t) => nodeTypes.has(t))) {
    return 'generation'
  }

  return 'custom'
}

/**
 * Apply variable values to a workflow template, producing a ready-to-submit prompt.
 */
export function applyVariables(
  apiJson: string,
  variableValues: Record<string, Record<string, unknown>>
): Record<string, ComfyUINode> {
  const nodes = parseWorkflowNodes(apiJson)

  for (const [nodeId, fields] of Object.entries(variableValues)) {
    if (nodes[nodeId]) {
      for (const [fieldName, value] of Object.entries(fields)) {
        nodes[nodeId].inputs[fieldName] = value
      }
    }
  }

  return nodes
}

/**
 * Get a list of prompt text nodes from a workflow (CLIPTextEncode nodes).
 * Useful for identifying which nodes should receive prompt module content.
 */
export function getPromptNodes(
  apiJson: string
): Array<{ nodeId: string; title: string; currentText: string; isNegative: boolean }> {
  const nodes = parseWorkflowNodes(apiJson)
  const result: Array<{ nodeId: string; title: string; currentText: string; isNegative: boolean }> =
    []

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.class_type === 'CLIPTextEncode') {
      const text = (node.inputs.text as string) || ''
      const title = node._meta?.title || `CLIPTextEncode #${nodeId}`
      const isNegative = isLikelyNegativePrompt(title, text)

      result.push({ nodeId, title, currentText: text, isNegative })
    }
  }

  return result
}

function isComfyUINode(value: unknown): value is ComfyUINode {
  return (
    isJsonObject(value) &&
    typeof value.class_type === 'string' &&
    isJsonObject(value.inputs) &&
    (value._meta === undefined || isJsonObject(value._meta))
  )
}

function isWorkflowNodeMap(value: unknown): value is Record<string, ComfyUINode> {
  return isJsonObject(value) && Object.values(value).every(isComfyUINode)
}

function parseWorkflowNodes(apiJson: string): Record<string, ComfyUINode> {
  const parsed = safeJsonParse<Record<string, ComfyUINode>>(apiJson, {
    context: 'Workflow JSON',
    validate: isWorkflowNodeMap,
    invalidShapeMessage: 'Workflow JSON must be a ComfyUI API-format node map'
  })

  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  return parsed.value
}

/**
 * Heuristic to detect if a CLIPTextEncode node is a negative prompt.
 */
function isLikelyNegativePrompt(title: string, text: string): boolean {
  const titleLower = title.toLowerCase()
  if (titleLower.includes('negative') || titleLower.includes('neg')) return true

  const negativeKeywords = [
    'worst quality',
    'low quality',
    'bad anatomy',
    'bad hands',
    'blurry',
    'deformed',
    'ugly'
  ]
  const matchCount = negativeKeywords.filter((kw) => text.toLowerCase().includes(kw)).length
  return matchCount >= 2
}

/**
 * Trace from a node's output through conditioning nodes to find a connected KSampler.
 * Returns the sampler node ID and which input name ('positive' or 'negative') the chain connects to.
 */
function traceToSampler(
  startNodeId: string,
  nodes: Record<string, ComfyUINode>,
  visited: Set<string> = new Set()
): { samplerNodeId: string; inputName: string } | null {
  if (visited.has(startNodeId)) return null
  visited.add(startNodeId)

  const samplerTypes = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom']
  const condTypes = [
    'ConditioningCombine',
    'ConditioningConcat',
    'ConditioningSetArea',
    'ConditioningSetMask'
  ]

  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const [inputName, inputValue] of Object.entries(node.inputs)) {
      if (!Array.isArray(inputValue) || inputValue[0] !== startNodeId) continue

      if (samplerTypes.includes(node.class_type)) {
        return { samplerNodeId: nodeId, inputName }
      }

      if (condTypes.includes(node.class_type)) {
        const result = traceToSampler(nodeId, nodes, visited)
        if (result) return result
      }
    }
  }
  return null
}

/**
 * Detect the role of a variable based on node connections and heuristics.
 */
function detectRole(
  nodeId: string,
  node: ComfyUINode,
  fieldName: string,
  varType: string,
  nodes: Record<string, ComfyUINode>
): string {
  if (varType === 'seed') return 'seed'

  // For text fields on CLIPTextEncode nodes, trace connection to KSampler
  if (node.class_type === 'CLIPTextEncode' && fieldName === 'text') {
    // Direct connection check
    for (const [, otherNode] of Object.entries(nodes)) {
      const samplerTypes = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom']
      if (!samplerTypes.includes(otherNode.class_type)) continue

      const posInput = otherNode.inputs.positive
      const negInput = otherNode.inputs.negative

      if (Array.isArray(posInput) && posInput[0] === nodeId) return 'prompt_positive'
      if (Array.isArray(negInput) && negInput[0] === nodeId) return 'prompt_negative'
    }

    // Indirect connection check (e.g. CLIPTextEncode → ConditioningCombine → KSampler)
    const traced = traceToSampler(nodeId, nodes)
    if (traced) {
      if (traced.inputName === 'positive') return 'prompt_positive'
      if (traced.inputName === 'negative') return 'prompt_negative'
    }

    // Fallback: title keyword heuristic
    const title = (node._meta?.title || '').toLowerCase()
    if (title.includes('부정') || title.includes('negative') || title.includes('neg '))
      return 'prompt_negative'
    if (title.includes('긍정') || title.includes('positive') || title.includes('pos '))
      return 'prompt_positive'

    // Content heuristic (last resort)
    const text = ((node.inputs.text as string) || '').toLowerCase()
    const negKeywords = ['worst quality', 'low quality', 'bad anatomy', 'deformed']
    if (negKeywords.filter((kw) => text.includes(kw)).length >= 2) return 'prompt_negative'

    return 'prompt_positive'
  }

  // For other text fields, check if they could be prompts
  if (varType === 'text') {
    const fn = fieldName.toLowerCase()
    if (fn.includes('prompt') || fn.includes('text')) {
      const title = (node._meta?.title || '').toLowerCase()
      if (title.includes('부정') || title.includes('negative')) return 'prompt_negative'
      if (title.includes('긍정') || title.includes('positive')) return 'prompt_positive'
    }
  }

  return 'custom'
}
