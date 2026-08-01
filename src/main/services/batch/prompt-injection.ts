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
        node.inputs[slot.fieldName] = slotPrompt
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

  for (const override of promptData.variableOverrides ?? []) {
    const node = workflow[override.nodeId] as { inputs?: Record<string, unknown> }
    if (!node?.inputs) continue
    const numericValue = Number(override.value)
    node.inputs[override.fieldName] = Number.isNaN(numericValue) ? override.value : numericValue
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
