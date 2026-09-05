import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { comfyuiManager } from '../../comfyui/manager'
import {
  prepareWorkflow,
  workflowPreparationInput,
  type SavedWorkflowSource
} from '../../comfyui/workflow-preparation'
import { persistPreparedWorkflowImport } from '../../comfyui/workflow-import'
import { workflowRepo } from './shared'
import { jsonError, jsonResult } from './response'

export function registerWorkflowPreparationTools(server: McpServer): void {
  server.tool(
    'prepare_workflow',
    'Prepare a ComfyUI workflow against installed node schemas without submitting generation. Sources: standard checkpoint text-to-image recipe with optional LoRAs, a saved workflow clone, or custom API JSON authored from inspect_comfyui. Static validation supports at most 500 nodes and requires an installed SaveImage or PreviewImage output. Defaults to dry_run=true: returns graph, roles, static validation and preparation_token. Save with identical inputs, dry_run=false and that token; fresh schema changes invalidate it. Creates a new workflow and never overwrites a source. Each saved call creates a record: after a lost response inspect list_workflows before retrying. Static checks cannot prove checkpoint architecture, custom validation, identity consistency or GPU capacity.',
    {
      ...workflowPreparationInput,
      dry_run: z.boolean().default(true),
      preparation_token: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional()
    },
    async (input) => {
      try {
        if (!comfyuiManager.isConnected)
          throw new Error('Connect ComfyUI before preparing a workflow')
        const info = await comfyuiManager.restClient.getObjectInfo()
        let savedSource: SavedWorkflowSource | undefined
        if (input.source.kind === 'saved_workflow') {
          const sourceId = input.source.workflow_id
          const saved = workflowRepo.get(sourceId)
          if (!saved) throw new Error('Source workflow not found')
          if (typeof saved.api_json !== 'string')
            throw new Error('Source workflow API JSON is invalid')
          savedSource = {
            content: saved.api_json,
            roles: workflowRepo.getVariables(sourceId).map((variable) => ({
              node_id: String(variable.node_id),
              field: String(variable.field_name),
              role: String(variable.role)
            }))
          }
        }
        const result = prepareWorkflow(input, info, savedSource)
        const report = {
          dry_run: input.dry_run,
          name: result.prepared.parsed.name,
          category: result.prepared.category,
          node_count: Object.keys(result.prepared.parsed.nodes).length,
          validation: result.validation,
          batch_ready: result.batch_ready && result.validation.valid,
          preparation_token: result.token,
          api_json: result.prepared.parsed.nodes,
          variables: result.prepared.parsed.variables
        }
        if (!result.validation.valid) return { ...jsonResult(report), isError: true }
        if (input.dry_run)
          return jsonResult({
            ...report,
            next_step:
              'Review graph, roles and warnings, then call prepare_workflow with identical inputs, dry_run=false and preparation_token. This does not generate images.'
          })
        if (input.preparation_token !== result.token)
          return jsonError(
            'Missing or stale preparation_token. Preview the same inputs again before saving.'
          )
        const savedResult = persistPreparedWorkflowImport(result.prepared, workflowRepo)
        return jsonResult({
          ...report,
          workflow_id: savedResult.id,
          next_step: { tool: 'get_workflow', arguments: { id: savedResult.id } }
        })
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : String(error))
      }
    }
  )
}
