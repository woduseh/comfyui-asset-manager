import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { basename } from 'path'
import { IPC_CHANNELS } from './channels'
import {
  SettingsRepository,
  WorkflowRepository,
  ModuleRepository,
  ModuleItemRepository,
  CharacterRepository,
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository
} from '../services/database/repositories'
import { comfyuiManager } from '../services/comfyui/manager'
import { parseWorkflow } from '../services/comfyui/workflow-parser'
import { previewPrompt, buildPrompt } from '../services/prompt/composition-engine'
import { expandBatchToTasks, calculateTaskCount } from '../services/batch/task-generator'
import type { BatchConfig, BatchModuleSelection } from '../services/batch/task-generator'
import { queueManager } from '../services/batch/queue-manager'
import { getDatabase } from '../services/database'

const settingsRepo = new SettingsRepository()
const workflowRepo = new WorkflowRepository()
const moduleRepo = new ModuleRepository()
const moduleItemRepo = new ModuleItemRepository()
const characterRepo = new CharacterRepository()
const batchJobRepo = new BatchJobRepository()
const batchTaskRepo = new BatchTaskRepository()
const imageRepo = new GeneratedImageRepository()

export function registerIpcHandlers(): void {
  // === ComfyUI Connection ===
  ipcMain.handle(IPC_CHANNELS.COMFYUI_CONNECT, async (_event, { host, port }: { host: string; port: number }) => {
    const success = await comfyuiManager.connect(host, port)
    return success
  })

  ipcMain.handle(IPC_CHANNELS.COMFYUI_DISCONNECT, () => {
    comfyuiManager.disconnect()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.COMFYUI_STATUS, () => {
    return {
      connected: comfyuiManager.isConnected,
      clientId: comfyuiManager.clientId
    }
  })

  ipcMain.handle(IPC_CHANNELS.COMFYUI_SYSTEM_STATS, async () => {
    if (!comfyuiManager.isConnected) return null
    try {
      return await comfyuiManager.restClient.getSystemStats()
    } catch {
      return null
    }
  })

  // === Available Models ===
  ipcMain.handle('comfyui:models', async () => {
    if (!comfyuiManager.isConnected) return null
    try {
      return await comfyuiManager.restClient.getAvailableModels()
    } catch {
      return null
    }
  })

  // === Workflow Import ===
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_IMPORT, (_event, { filePath }: { filePath: string }) => {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const json = JSON.parse(content)
      const fileName = basename(filePath, '.json')

      // Detect if this is UI format or API format
      let apiJson: string
      let uiJson: string | null = null

      if (json.nodes && json.links) {
        // This is UI format - we'd need conversion, store as-is for now
        // TODO: Implement UI→API format conversion
        uiJson = content
        throw new Error('UI format workflow detected. Please export in API format (Save API Format).')
      } else {
        // This is API format
        apiJson = content
      }

      const parsed = parseWorkflow(apiJson, fileName)

      // Save to database
      const workflowId = workflowRepo.create({
        name: parsed.name,
        description: `Imported from ${basename(filePath)}`,
        category: parsed.suggestedCategory,
        api_json: apiJson,
        ui_json: uiJson || undefined,
        variables: JSON.stringify(parsed.variables)
      })

      // Save extracted variables
      workflowRepo.setVariables(
        workflowId,
        parsed.variables.map((v) => ({
          node_id: v.nodeId,
          field_name: v.fieldName,
          display_name: v.displayName,
          var_type: v.varType,
          default_val: v.currentValue !== undefined ? String(v.currentValue) : undefined,
          description: `${v.nodeType} → ${v.fieldName}`,
          role: v.role
        }))
      )

      return { id: workflowId, name: parsed.name, category: parsed.suggestedCategory, variableCount: parsed.variables.length }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  // === Workflow Variable Management ===
  ipcMain.handle('workflow:variables', (_event, { workflowId }: { workflowId: string }) => {
    return workflowRepo.getVariables(workflowId)
  })

  ipcMain.handle('workflow:set-variables', (_event, { workflowId, variables }: { workflowId: string; variables: Array<{ node_id: string; field_name: string; display_name: string; var_type: string; default_val?: string; description?: string }> }) => {
    workflowRepo.setVariables(workflowId, variables)
    return true
  })

  // Update variable role
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_ROLE, (_event, { variableId, role }: { variableId: string; role: string }) => {
    workflowRepo.updateVariableRole(variableId, role)
    return true
  })

  // Update variable value
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_VALUE, (_event, { variableId, value }: { variableId: string; value: string }) => {
    workflowRepo.updateValue(variableId, value)
    return true
  })

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET,(_event, { key }: { key: string }) => {
    return settingsRepo.get(key)
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, { key, value }: { key: string; value: string }) => {
    settingsRepo.set(key, value)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return settingsRepo.getAll()
  })

  // Workflows
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_LIST, (_event, args?: { category?: string }) => {
    return workflowRepo.list(args?.category)
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_GET, (_event, { id }: { id: string }) => {
    return workflowRepo.get(id)
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_DELETE, (_event, { id }: { id: string }) => {
    workflowRepo.delete(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_UPDATE, (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
    workflowRepo.update(id, data)
    return true
  })

  // Modules
  ipcMain.handle(IPC_CHANNELS.MODULE_LIST, (_event, args?: { type?: string }) => {
    return moduleRepo.list(args?.type)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_GET, (_event, { id }: { id: string }) => {
    return moduleRepo.get(id)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_CREATE, (_event, data: { name: string; type: string; description?: string; parent_id?: string }) => {
    return moduleRepo.create(data)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_UPDATE, (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
    moduleRepo.update(id, data)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_DELETE, (_event, { id }: { id: string }) => {
    moduleRepo.delete(id)
    return true
  })

  // Module Items
  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_LIST, (_event, { moduleId }: { moduleId: string }) => {
    return moduleItemRepo.list(moduleId)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_CREATE, (_event, data: { module_id: string; name: string; prompt: string; negative?: string; weight?: number; sort_order?: number; metadata?: string }) => {
    return moduleItemRepo.create(data)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_UPDATE, (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
    moduleItemRepo.update(id, data)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_DELETE, (_event, { id }: { id: string }) => {
    moduleItemRepo.delete(id)
    return true
  })

  // Characters
  ipcMain.handle(IPC_CHANNELS.CHARACTER_LIST, () => {
    return characterRepo.list()
  })

  ipcMain.handle(IPC_CHANNELS.CHARACTER_GET, (_event, { id }: { id: string }) => {
    return characterRepo.get(id)
  })

  ipcMain.handle(IPC_CHANNELS.CHARACTER_CREATE, (_event, data: { name: string; base_prompt: string; negative_prompt?: string; metadata?: string }) => {
    return characterRepo.create(data)
  })

  ipcMain.handle(IPC_CHANNELS.CHARACTER_UPDATE, (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
    characterRepo.update(id, data)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.CHARACTER_DELETE, (_event, { id }: { id: string }) => {
    characterRepo.delete(id)
    return true
  })

  // Batch
  ipcMain.handle(IPC_CHANNELS.BATCH_LIST, (_event, args?: { status?: string }) => {
    return batchJobRepo.list(args?.status)
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_GET, (_event, { id }: { id: string }) => {
    return batchJobRepo.get(id)
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_DELETE, (_event, { id }: { id: string }) => {
    batchJobRepo.delete(id)
    return true
  })

  // Batch task count preview
  ipcMain.handle('batch:preview-count', (_event, { moduleSelections, countPerCombination }: { moduleSelections: BatchModuleSelection[]; countPerCombination: number }) => {
    return calculateTaskCount(moduleSelections, countPerCombination)
  })

  // Create batch job and expand to tasks
  ipcMain.handle(IPC_CHANNELS.BATCH_CREATE, (_event, config: BatchConfig) => {
    // Store original config for DB (preserves module IDs for cloning)
    const originalConfigJson = JSON.stringify(config)

    // Resolve prefix module IDs to composed text
    if (config.slotMappings) {
      for (const slot of config.slotMappings) {
        if (slot.action === 'inject' && slot.prefixModuleIds && slot.prefixModuleIds.length > 0) {
          const prefixModules = slot.prefixModuleIds.map(moduleId => {
            const mod = moduleRepo.get(moduleId)
            const items = moduleItemRepo.list(moduleId)
            return {
              type: (mod?.type as string) || 'custom',
              items: items
                .filter(item => (item.enabled as number) !== 0)
                .map(item => ({
                  prompt: item.prompt as string,
                  negative: (item.negative as string) || '',
                  weight: (item.weight as number) || 1.0,
                  enabled: true
                }))
            }
          }).filter(m => m.items.length > 0)

          if (prefixModules.length > 0) {
            const composed = buildPrompt(prefixModules)
            const composedText = slot.role === 'prompt_positive' ? composed.positive : composed.negative
            if (composedText.trim()) {
              slot.prefixText = composedText.trim() + (slot.prefixText?.trim() ? ', ' + slot.prefixText.trim() : '')
            }
          }
        }
      }
    }

    // Load module data for expansion
    const moduleData = config.moduleSelections.map((sel) => {
      const items = moduleItemRepo.list(sel.moduleId)
      return {
        moduleId: sel.moduleId,
        moduleType: sel.moduleType,
        items: items.map((item) => ({
          id: item.id as string,
          name: item.name as string,
          prompt: item.prompt as string,
          negative: (item.negative as string) || '',
          weight: (item.weight as number) || 1.0,
          enabled: (item.enabled as number) !== 0
        }))
      }
    })

    const tasks = expandBatchToTasks(config, moduleData)

    // Create the job
    const jobId = batchJobRepo.create({
      name: config.name,
      description: config.description,
      config: originalConfigJson,
      workflow_id: config.workflowId,
      total_tasks: tasks.length,
      pipeline_config: config.pipelineConfig ? JSON.stringify(config.pipelineConfig) : undefined
    })

    // Create tasks in bulk
    if (tasks.length > 0) {
      batchTaskRepo.createBulk(
        tasks.map((t) => ({
          job_id: jobId,
          prompt_data: JSON.stringify(t.promptData),
          sort_order: t.sortOrder,
          metadata: JSON.stringify(t.metadata)
        }))
      )
    }

    return { jobId, totalTasks: tasks.length }
  })

  // Get tasks for a batch job
  ipcMain.handle('batch:tasks', (_event, { jobId }: { jobId: string }) => {
    return batchTaskRepo.listByJob(jobId)
  })

  // Queue execution control
  ipcMain.handle(IPC_CHANNELS.BATCH_START, async (_event, { id }: { id: string }) => {
    try {
      await queueManager.startJob(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_PAUSE, () => {
    queueManager.pause()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_RESUME, async () => {
    await queueManager.resume()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_CANCEL, () => {
    queueManager.cancel()
    return true
  })

  ipcMain.handle('queue:status', () => {
    return {
      isProcessing: queueManager.isProcessing,
      isPaused: queueManager.isPaused,
      currentJobId: queueManager.currentJobId
    }
  })

  // Gallery
  ipcMain.handle(IPC_CHANNELS.GALLERY_LIST, (_event, query) => {
    return imageRepo.list(query)
  })

  ipcMain.handle(IPC_CHANNELS.GALLERY_RATE, (_event, { id, rating }: { id: string; rating: number }) => {
    imageRepo.updateRating(id, rating)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.GALLERY_FAVORITE, (_event, { id, favorite }: { id: string; favorite: boolean }) => {
    imageRepo.updateFavorite(id, favorite)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.GALLERY_DELETE, (_event, { ids }: { ids: string[] }) => {
    imageRepo.delete(ids)
    return true
  })

  // Prompt Preview
  ipcMain.handle('prompt:preview', (_event, { moduleIds, variables }: { moduleIds: string[]; variables?: Record<string, string> }) => {
    const modules: Array<{
      type: string
      items: Array<{ prompt: string; negative: string; weight: number; enabled: boolean }>
    }> = []

    for (const moduleId of moduleIds) {
      const mod = moduleRepo.get(moduleId)
      if (!mod) continue
      const items = moduleItemRepo.list(moduleId)
      modules.push({
        type: mod.type as string,
        items: items.map((item) => ({
          prompt: item.prompt as string,
          negative: (item.negative as string) || '',
          weight: (item.weight as number) || 1.0,
          enabled: (item.enabled as number) !== 0
        }))
      })
    }

    return previewPrompt(modules, variables)
  })

  // Module import/export
  ipcMain.handle('module:export', (_event, { moduleId }: { moduleId: string }) => {
    const mod = moduleRepo.get(moduleId)
    if (!mod) return null
    const items = moduleItemRepo.list(moduleId)
    return JSON.stringify({ module: mod, items }, null, 2)
  })

  ipcMain.handle('module:import-data', (_event, { jsonData }: { jsonData: string }) => {
    try {
      const data = JSON.parse(jsonData)
      if (!data.module || !data.items) throw new Error('Invalid module export format')
      const modId = moduleRepo.create({
        name: data.module.name + ' (imported)',
        type: data.module.type,
        description: data.module.description || '',
        parent_id: data.module.parent_id || undefined
      })
      for (const item of data.items) {
        moduleItemRepo.create({
          module_id: modId,
          name: item.name,
          prompt: item.prompt,
          negative: item.negative || '',
          weight: item.weight ?? 1.0,
          sort_order: item.sort_order ?? 0,
          metadata: item.metadata || '{}'
        })
      }
      return { id: modId, name: data.module.name }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  // Dashboard statistics
  ipcMain.handle('dashboard:stats', () => {
    const db = getDatabase()

    const imgCountStmt = db.prepare('SELECT COUNT(*) as count FROM generated_images')
    imgCountStmt.step()
    const totalImages = (imgCountStmt.getAsObject() as { count: number }).count
    imgCountStmt.free()

    const favCountStmt = db.prepare('SELECT COUNT(*) as count FROM generated_images WHERE is_favorite = 1')
    favCountStmt.step()
    const favoriteCount = (favCountStmt.getAsObject() as { count: number }).count
    favCountStmt.free()

    const jobCountStmt = db.prepare('SELECT COUNT(*) as count FROM batch_jobs')
    jobCountStmt.step()
    const totalJobs = (jobCountStmt.getAsObject() as { count: number }).count
    jobCountStmt.free()

    const completedJobsStmt = db.prepare("SELECT COUNT(*) as count FROM batch_jobs WHERE status = 'completed'")
    completedJobsStmt.step()
    const completedJobs = (completedJobsStmt.getAsObject() as { count: number }).count
    completedJobsStmt.free()

    const workflowCountStmt = db.prepare('SELECT COUNT(*) as count FROM workflows')
    workflowCountStmt.step()
    const totalWorkflows = (workflowCountStmt.getAsObject() as { count: number }).count
    workflowCountStmt.free()

    const moduleCountStmt = db.prepare('SELECT COUNT(*) as count FROM prompt_modules')
    moduleCountStmt.step()
    const totalModules = (moduleCountStmt.getAsObject() as { count: number }).count
    moduleCountStmt.free()

    // Recent images (last 10)
    const recentStmt = db.prepare('SELECT id, file_path, character_name, emotion_name, created_at FROM generated_images ORDER BY created_at DESC LIMIT 10')
    const recentImages: Record<string, unknown>[] = []
    while (recentStmt.step()) {
      recentImages.push(recentStmt.getAsObject())
    }
    recentStmt.free()

    return {
      totalImages,
      favoriteCount,
      totalJobs,
      completedJobs,
      totalWorkflows,
      totalModules,
      recentImages
    }
  })

  // Dialogs
  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILE, async (_event, args?: { filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: args?.filters || [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
