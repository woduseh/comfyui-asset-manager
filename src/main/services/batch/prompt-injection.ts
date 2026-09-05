import type { TaskPromptData } from './queue-utils'

export function injectPromptData(
  workflow: Record<string, unknown>,
  promptData: TaskPromptData
): void {
  if (promptData.slotMappings?.length) {
    for (const slot of promptData.slotMappings) {
      const node = workflow[slot.nodeId] as { inputs?: Record<string, unknown> }
      if (!node?.inputs) continue
      if (slot.action === 'inject') {
        const slotKey = `${slot.nodeId}:${slot.fieldName}`
        const slotPrompt = promptData.slotPrompts?.[slotKey]
        node.inputs[slot.fieldName] =
          slotPrompt !== undefined
            ? slotPrompt
            : slot.role === 'prompt_positive'
              ? promptData.positive
              : promptData.negative
      } else if (slot.action === 'fixed') {
        node.inputs[slot.fieldName] = slot.fixedValue
      }
    }

    for (const nodeData of Object.values(workflow)) {
      const node = nodeData as { class_type?: string; inputs?: Record<string, unknown> }
      if (
        node.inputs &&
        (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced')
      ) {
        node.inputs.seed = promptData.seed
        if (node.inputs.noise_seed !== undefined) node.inputs.noise_seed = promptData.seed
      }
    }
  } else {
    for (const nodeData of Object.values(workflow)) {
      const node = nodeData as { class_type?: string; inputs?: Record<string, unknown> }
      if (!node.class_type || !node.inputs) continue
      if (node.class_type === 'CLIPTextEncode') {
        const currentText = node.inputs.text
        if (typeof currentText === 'string' && currentText) {
          const normalized = currentText.toLowerCase()
          const isNegative =
            normalized.includes('worst quality') ||
            normalized.includes('low quality') ||
            normalized.includes('bad anatomy')
          node.inputs.text = isNegative ? promptData.negative : promptData.positive
        }
      } else if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
        node.inputs.seed = promptData.seed
        if (node.inputs.noise_seed !== undefined) node.inputs.noise_seed = promptData.seed
      }
    }
  }

  for (const nodeData of Object.values(workflow)) {
    const node = nodeData as { inputs?: Record<string, unknown> }
    if (!node.inputs) continue
    for (const field of ['seed', 'noise_seed']) {
      if (typeof node.inputs[field] === 'number') node.inputs[field] = promptData.seed
    }
  }

  for (const override of promptData.variableOverrides ?? []) {
    const node = workflow[override.nodeId] as { inputs?: Record<string, unknown> }
    if (!node?.inputs || !Object.prototype.hasOwnProperty.call(node.inputs, override.fieldName)) {
      continue
    }
    const currentValue = node.inputs[override.fieldName]
    if (typeof currentValue === 'number') {
      const numericValue = Number(override.value)
      if (!override.value.trim() || !Number.isFinite(numericValue)) {
        throw new Error(`Expected a finite number for ${override.nodeId}:${override.fieldName}`)
      }
      node.inputs[override.fieldName] = numericValue
    } else if (typeof currentValue === 'boolean') {
      if (override.value !== 'true' && override.value !== 'false') {
        throw new Error(`Expected true or false for ${override.nodeId}:${override.fieldName}`)
      }
      node.inputs[override.fieldName] = override.value === 'true'
    } else if (typeof currentValue === 'string') {
      node.inputs[override.fieldName] = override.value
    }
  }

  if (promptData.extraVariables) {
    for (const nodeData of Object.values(workflow)) {
      const node = nodeData as { inputs?: Record<string, unknown> }
      if (!node.inputs) continue
      for (const [key, value] of Object.entries(promptData.extraVariables)) {
        if (key in node.inputs) node.inputs[key] = value
      }
    }
  }
}
