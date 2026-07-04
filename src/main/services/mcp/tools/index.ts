import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerModuleCoreTools } from './modules'
import { registerItemCoreTools } from './items'
import { registerItemOperationTools } from './item-operations'
import { registerItemBulkTools } from './item-bulk'
import { registerFileImportTools } from './file-import'
import { registerModuleAnalysisTools } from './module-analysis'
import { registerFileSyncTools } from './file-sync'
import { registerWorkflowAndBatchTools } from './workflows-batch'
import { registerTagTools } from './tags'

export function registerMcpTools(server: McpServer): void {
  registerModuleCoreTools(server)
  registerItemCoreTools(server)
  registerItemOperationTools(server)
  registerItemBulkTools(server)
  registerFileImportTools(server)
  registerModuleAnalysisTools(server)
  registerFileSyncTools(server)
  registerWorkflowAndBatchTools(server)
  registerTagTools(server)
}
