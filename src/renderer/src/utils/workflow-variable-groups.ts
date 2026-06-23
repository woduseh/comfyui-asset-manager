export const WORKFLOW_ROLE_ORDER = [
  'prompt_positive',
  'prompt_negative',
  'seed',
  'fixed',
  'custom'
] as const

export type WorkflowRole = (typeof WORKFLOW_ROLE_ORDER)[number]

export interface WorkflowVariableGroup {
  role: WorkflowRole
  variables: Record<string, unknown>[]
}

export function groupWorkflowVariables(
  variables: Record<string, unknown>[]
): WorkflowVariableGroup[] {
  const grouped = new Map<WorkflowRole, Record<string, unknown>[]>()
  for (const role of WORKFLOW_ROLE_ORDER) grouped.set(role, [])

  for (const variable of variables) {
    const rawRole = typeof variable.role === 'string' ? variable.role : 'custom'
    const role = WORKFLOW_ROLE_ORDER.includes(rawRole as WorkflowRole)
      ? (rawRole as WorkflowRole)
      : 'custom'
    grouped.get(role)!.push(variable)
  }

  return WORKFLOW_ROLE_ORDER.map((role) => ({ role, variables: grouped.get(role)! })).filter(
    (group) => group.variables.length > 0
  )
}
