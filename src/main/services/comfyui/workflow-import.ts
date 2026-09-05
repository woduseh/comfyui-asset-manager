import { readFileSync, statSync } from 'fs'
import { basename, extname, isAbsolute } from 'path'
import { MAX_WORKFLOW_FILE_SIZE_BYTES } from '../../constants'
import { withTransaction } from '../database'
import { isJsonObject, safeJsonParse } from '@shared/safe-json'
import { analyzeWorkflowNodes, isWorkflowNodeMap, type ParsedWorkflow } from './workflow-parser'
import type { ComfyUINode } from './types'

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

interface WorkflowImportOptions {
  name?: string
  category?: ParsedWorkflow['suggestedCategory']
  description?: string
}

export interface PreparedWorkflowImport {
  content: string
  parsed: ParsedWorkflow
  category: ParsedWorkflow['suggestedCategory']
  description?: string
}

/** Validate import content before traversing graph links or modifying primitive inputs. */
export function readWorkflowImportNodes(content: string): Record<string, ComfyUINode> {
  if (Buffer.byteLength(content, 'utf-8') > MAX_WORKFLOW_FILE_SIZE_BYTES) {
    throw new Error('Workflow file exceeds the 10MB size limit')
  }
  const workflowJson = safeJsonParse<Record<string, unknown>>(content, {
    context: 'Workflow file',
    validate: isJsonObject,
    invalidShapeMessage: 'Workflow file must contain a JSON object'
  })
  if (!workflowJson.ok) throw new Error(workflowJson.error)
  if (workflowJson.value.nodes && workflowJson.value.links) {
    throw new Error('UI format workflow detected. Please export in API format (Save API Format).')
  }
  if (!isWorkflowNodeMap(workflowJson.value)) {
    throw new Error('Workflow JSON must be a ComfyUI API-format node map')
  }
  if (Object.keys(workflowJson.value).length === 0) {
    throw new Error('Workflow must contain at least one API node')
  }
  return workflowJson.value
}

export function prepareWorkflowImport(
  content: string,
  options: WorkflowImportOptions = {}
): PreparedWorkflowImport {
  const parsed = analyzeWorkflowNodes(readWorkflowImportNodes(content), options.name)
  return {
    content,
    parsed,
    category: options.category ?? parsed.suggestedCategory,
    description: options.description
  }
}

export function persistPreparedWorkflowImport(
  prepared: PreparedWorkflowImport,
  repository: WorkflowImportRepository,
  runInTransaction: WorkflowImportDependencies['runInTransaction'] = withTransaction
): WorkflowImportResult {
  const { parsed, content, category, description } = prepared
  return runInTransaction(() => {
    const workflowId = repository.create({
      name: parsed.name,
      description,
      category,
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
    return { id: workflowId, name: parsed.name, category, variableCount: parsed.variables.length }
  })
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
  const fileName = basename(filePath, extname(filePath))
  const prepared = prepareWorkflowImport(content, {
    name: fileName,
    description: `Imported from ${basename(filePath)}`
  })
  return persistPreparedWorkflowImport(prepared, repository, deps.runInTransaction)
}
