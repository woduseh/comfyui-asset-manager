import { readFileSync, statSync } from 'fs'
import { basename, extname, isAbsolute } from 'path'
import { MAX_WORKFLOW_FILE_SIZE_BYTES } from '../../constants'
import { withTransaction } from '../database'
import { isJsonObject, safeJsonParse } from '../../utils/safe-json'
import { parseWorkflow } from './workflow-parser'

interface WorkflowImportRepository {
  create(data: {
    name: string
    description?: string
    category: string
    api_json: string
    ui_json?: string
    variables?: string
  }): string
  setVariables(
    workflowId: string,
    variables: Array<{
      node_id: string
      field_name: string
      display_name: string
      var_type: string
      default_val?: string
      description?: string
      role?: string
    }>
  ): void
}

interface WorkflowImportDependencies {
  readTextFile: (filePath: string) => string
  getFileSize: (filePath: string) => number
  runInTransaction: <T>(operation: () => T) => T
}

export interface WorkflowImportResult {
  id: string
  name: string
  category: string
  variableCount: number
}

const DEFAULT_DEPENDENCIES: WorkflowImportDependencies = {
  readTextFile: (filePath) => readFileSync(filePath, 'utf-8'),
  getFileSize: (filePath) => statSync(filePath).size,
  runInTransaction: withTransaction
}

export function importWorkflowFromSelectedPath(
  filePath: string,
  repository: WorkflowImportRepository,
  dependencies: Partial<WorkflowImportDependencies> = {}
): WorkflowImportResult {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies }

  if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== '.json') {
    throw new Error('Expected an absolute JSON workflow path')
  }

  const fileSize = deps.getFileSize(filePath)
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error('Invalid workflow file size')
  }
  if (fileSize > MAX_WORKFLOW_FILE_SIZE_BYTES) {
    throw new Error('Workflow file exceeds the 10MB size limit')
  }

  const content = deps.readTextFile(filePath)
  const workflowJson = safeJsonParse<Record<string, unknown>>(content, {
    context: 'Workflow file',
    validate: isJsonObject,
    invalidShapeMessage: 'Workflow file must contain a JSON object'
  })
  if (!workflowJson.ok) {
    throw new Error(workflowJson.error)
  }

  if (workflowJson.value.nodes && workflowJson.value.links) {
    throw new Error('UI format workflow detected. Please export in API format (Save API Format).')
  }

  const fileName = basename(filePath, extname(filePath))
  const parsed = parseWorkflow(content, fileName)

  return deps.runInTransaction(() => {
    const workflowId = repository.create({
      name: parsed.name,
      description: `Imported from ${basename(filePath)}`,
      category: parsed.suggestedCategory,
      api_json: content,
      variables: JSON.stringify(parsed.variables)
    })

    repository.setVariables(
      workflowId,
      parsed.variables.map((variable) => ({
        node_id: variable.nodeId,
        field_name: variable.fieldName,
        display_name: variable.displayName,
        var_type: variable.varType,
        default_val:
          variable.currentValue !== undefined ? String(variable.currentValue) : undefined,
        description: `${variable.nodeType} → ${variable.fieldName}`,
        role: variable.role
      }))
    )

    return {
      id: workflowId,
      name: parsed.name,
      category: parsed.suggestedCategory,
      variableCount: parsed.variables.length
    }
  })
}
