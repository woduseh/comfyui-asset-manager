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
import { registerGalleryTools } from './gallery'
import { registerExecutionTools } from './execution'
import { registerWorkflowPreparationTools } from './workflow-preparation'
import { registerComfyUICatalogTools } from './comfyui-catalog'
import { withToolContracts } from './tool-contract'
import { registerGenerationGuideTools } from './guide'

export function registerMcpTools(server: McpServer): void {
  server = withToolContracts(server)
  registerModuleCoreTools(server)
  registerItemCoreTools(server)
  registerItemOperationTools(server)
  registerItemBulkTools(server)
  registerFileImportTools(server)
  registerModuleAnalysisTools(server)
  registerFileSyncTools(server)
  registerWorkflowAndBatchTools(server)
  registerTagTools(server)
  registerGalleryTools(server)
  registerExecutionTools(server)
  registerComfyUICatalogTools(server)
  registerWorkflowPreparationTools(server)
  registerGenerationGuideTools(server)
}
