import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { flushDatabase } from '../../database'
import { jsonError, jsonResult } from './response'

const externalTools = new Set([
  'start_batch_job',
  'control_batch_job',
  'inspect_comfyui',
  'prepare_workflow',
  'connect_comfyui',
  'export_module_items_to_file',
  'import_module_items_from_file',
  'diff_module_with_file',
  'sync_module_from_file',
  'search_danbooru_tags',
  'validate_danbooru_tags',
  'validate_module_tags'
])
const idempotentWrites = new Set([
  'update_module',
  'update_module_items',
  'delete_module',
  'delete_module_item',
  'review_generated_image'
])

export function toolAnnotations(name: string): ToolAnnotations {
  const readOnly = /^(list_|get_|search_|validate_|diff_|preview_|wait_|inspect_)/.test(name)
  return {
    readOnlyHint: readOnly,
    destructiveHint:
      !readOnly && !/^(create_|duplicate_|import_|connect_|start_|prepare_)/.test(name),
    idempotentHint: readOnly || idempotentWrites.has(name),
    openWorldHint: externalTools.has(name)
  }
}

/** Adapt existing registrations to the SDK config API without changing tool names. */
export function withToolContracts(server: McpServer): McpServer {
  return {
    tool: (
      name: string,
      description: string,
      inputSchema: z.ZodRawShape,
      handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>
    ) => {
      const annotations = toolAnnotations(name)
      return server.registerTool(
        name,
        { description, inputSchema, annotations },
        async (args, extra) => {
          let result: CallToolResult
          try {
            result = await handler(args, extra)
          } catch (error) {
            return jsonError(error instanceof Error ? error.message : String(error))
          }
          if (!annotations.readOnlyHint) {
            try {
              // Repositories schedule saves. Waiting here confirms durability without scheduling another write.
              await flushDatabase()
            } catch (error) {
              return {
                ...jsonResult({
                  error: error instanceof Error ? error.message : String(error),
                  code: 'PERSISTENCE_UNCONFIRMED',
                  retryable: false,
                  result: result.structuredContent ?? result.content,
                  next_action:
                    'Keep returned IDs and inspect existing records before retrying. The mutation may already exist in memory.'
                }),
                isError: true
              }
            }
          }
          return result
        }
      )
    },
    prompt: server.prompt.bind(server)
  } as unknown as McpServer
}
