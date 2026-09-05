import type { ComfyUINode, ComfyUIObjectInfo } from './types'

export interface WorkflowValidationIssue {
  code: string
  node_id?: string
  field?: string
  message: string
}

export interface WorkflowValidationResult {
  valid: boolean
  errors: WorkflowValidationIssue[]
  warnings: WorkflowValidationIssue[]
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function typesMatch(actual: string, expected: string): boolean {
  const source = actual.split(',').map((type) => type.trim())
  const target = expected.split(',').map((type) => type.trim())
  return (
    source.includes('*') || target.includes('*') || source.every((type) => target.includes(type))
  )
}

/** Static validation against the installed server's object_info; never submits a prompt. */
export function validateWorkflowGraph(
  nodes: Record<string, ComfyUINode>,
  objectInfo: ComfyUIObjectInfo
): WorkflowValidationResult {
  const errors: WorkflowValidationIssue[] = []
  const warnings: WorkflowValidationIssue[] = [
    {
      code: 'STATIC_VALIDATION_ONLY',
      message:
        'Static object_info validation does not execute custom VALIDATE_INPUTS, load models, verify model compatibility or available VRAM, or guarantee successful generation.'
    }
  ]
  let truncated = false
  const error = (issue: WorkflowValidationIssue): void => {
    if (errors.length < 100) errors.push(issue)
    else truncated = true
  }
  const warning = (issue: WorkflowValidationIssue): void => {
    if (warnings.length < 19) warnings.push(issue)
    else truncated = true
  }
  const finish = (): WorkflowValidationResult => {
    if (truncated)
      warnings.push({
        code: 'ISSUES_TRUNCATED',
        message: 'Additional issues were omitted; fix reported issues and validate again.'
      })
    return { valid: errors.length === 0, errors, warnings }
  }
  if (!record(nodes) || Object.keys(nodes).length === 0) {
    error({ code: 'EMPTY_GRAPH', message: 'Workflow must contain at least one node.' })
    return finish()
  }
  if (Object.keys(nodes).length > 500) {
    error({ code: 'NODE_LIMIT', message: 'Static validation supports at most 500 workflow nodes.' })
    return finish()
  }
  const edges = new Map<string, string[]>()
  let hasImageOutput = false
  for (const [nodeId, node] of Object.entries(nodes)) {
    edges.set(nodeId, [])
    if (!record(node) || typeof node.class_type !== 'string' || !record(node.inputs)) {
      error({
        code: 'INVALID_NODE',
        node_id: nodeId,
        message: 'Node requires class_type and an inputs object.'
      })
      continue
    }
    const schema = Object.hasOwn(objectInfo, node.class_type)
      ? objectInfo[node.class_type]
      : undefined
    if (!schema) {
      error({
        code: 'MISSING_NODE_TYPE',
        node_id: nodeId,
        message: `Node type is not installed: ${node.class_type}`
      })
      continue
    }
    if (
      (node.class_type === 'SaveImage' || node.class_type === 'PreviewImage') &&
      schema.output_node === true
    )
      hasImageOutput = true
    const required = schema.input?.required ?? {}
    const optional = schema.input?.optional ?? {}
    const hidden =
      (schema.input as typeof schema.input & { hidden?: Record<string, unknown> })?.hidden ?? {}
    for (const field of Object.keys(required)) {
      if (!Object.hasOwn(node.inputs, field))
        error({
          code: 'MISSING_INPUT',
          node_id: nodeId,
          field,
          message: `Required input is missing: ${field}`
        })
    }
    for (const [field, value] of Object.entries(node.inputs)) {
      if (errors.length >= 100) {
        truncated = true
        break
      }
      const issue = (code: string, message: string): WorkflowValidationIssue => ({
        code,
        node_id: nodeId,
        field,
        message
      })
      const definition = Object.hasOwn(required, field)
        ? required[field]
        : Object.hasOwn(optional, field)
          ? optional[field]
          : undefined
      if (!definition) {
        if (Object.hasOwn(hidden, field))
          warning(
            issue(
              'HIDDEN_INPUT',
              'Hidden input is managed by ComfyUI; its supplied value is not statically validated.'
            )
          )
        else
          error(issue('UNKNOWN_INPUT', `Input is not advertised by the installed node: ${field}`))
        continue
      }
      const expected = definition[0]
      const metadata = record(definition[1]) ? definition[1] : {}
      if (Array.isArray(value)) {
        if (
          value.length !== 2 ||
          typeof value[0] !== 'string' ||
          !Number.isInteger(value[1]) ||
          Number(value[1]) < 0
        ) {
          error(issue('INVALID_LINK', 'Links must be [source_node_id, nonnegative_output_index].'))
          continue
        }
        const [sourceId, slot] = value as [string, number]
        if (!Object.hasOwn(nodes, sourceId)) {
          error(issue('MISSING_LINK_NODE', `Linked node does not exist: ${sourceId}`))
          continue
        }
        edges.get(nodeId)!.push(sourceId)
        const sourceNode = nodes[sourceId]
        const sourceInfo =
          record(sourceNode) &&
          typeof sourceNode.class_type === 'string' &&
          Object.hasOwn(objectInfo, sourceNode.class_type)
            ? objectInfo[sourceNode.class_type]
            : undefined
        if (!sourceInfo) continue
        if (!Array.isArray(sourceInfo.output) || slot >= sourceInfo.output.length) {
          error(
            issue(
              'LINK_SLOT_RANGE',
              `Linked output index is outside the source node outputs: ${slot}`
            )
          )
          continue
        }
        const actual = sourceInfo.output[slot]
        const targetType = Array.isArray(expected) ? 'STRING,COMBO' : expected
        if (typeof actual !== 'string' || typeof targetType !== 'string') {
          warning(
            issue(
              'UNKNOWN_LINK_TYPE',
              'Installed node metadata does not describe a comparable link type.'
            )
          )
        } else if (!typesMatch(actual, targetType)) {
          error(
            issue(
              'LINK_TYPE_MISMATCH',
              `Output type ${actual} cannot feed input type ${targetType}.`
            )
          )
        } else if (Array.isArray(expected)) {
          warning(
            issue(
              'DYNAMIC_ENUM',
              'Linked enum/model selection cannot be checked against installed choices until execution.'
            )
          )
        }
        continue
      }
      if (metadata.forceInput === true) {
        error(issue('LINK_REQUIRED', 'Installed input requires a node link.'))
        continue
      }
      if (Array.isArray(expected)) {
        if (!expected.some((choice) => choice === value))
          error(
            issue(
              'INVALID_CHOICE',
              'Value is not in the installed node choices; check the available model/file names.'
            )
          )
        continue
      }
      if (typeof expected !== 'string') {
        warning(
          issue('UNKNOWN_INPUT_SCHEMA', 'Installed input schema cannot be statically validated.')
        )
        continue
      }
      const alternatives = expected.split(',').map((type) => type.trim())
      const validPrimitive = alternatives.some(
        (type) =>
          type === '*' ||
          (type === 'INT' && typeof value === 'number' && Number.isSafeInteger(value)) ||
          (type === 'FLOAT' && typeof value === 'number' && Number.isFinite(value)) ||
          (type === 'STRING' && typeof value === 'string') ||
          (type === 'BOOLEAN' && typeof value === 'boolean')
      )
      if (!validPrimitive) {
        error(
          issue(
            'INPUT_TYPE_MISMATCH',
            `Expected ${expected}; custom data types require a compatible node link.`
          )
        )
        continue
      }
      if (typeof value === 'number') {
        if (typeof metadata.min === 'number' && value < metadata.min)
          error(issue('INPUT_MIN', `Value is below the installed minimum ${metadata.min}.`))
        if (typeof metadata.max === 'number' && value > metadata.max)
          error(issue('INPUT_MAX', `Value exceeds the installed maximum ${metadata.max}.`))
      }
    }
  }
  const active = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): void => {
    if (active.has(nodeId)) {
      error({ code: 'CYCLE', node_id: nodeId, message: 'Workflow contains a dependency cycle.' })
      return
    }
    if (visited.has(nodeId)) return
    active.add(nodeId)
    for (const source of edges.get(nodeId) ?? []) visit(source)
    active.delete(nodeId)
    visited.add(nodeId)
  }
  for (const nodeId of edges.keys()) visit(nodeId)
  if (!hasImageOutput)
    error({
      code: 'MISSING_IMAGE_OUTPUT',
      message:
        'Workflow requires SaveImage or PreviewImage advertised as output_node by the installed server.'
    })
  return finish()
}
