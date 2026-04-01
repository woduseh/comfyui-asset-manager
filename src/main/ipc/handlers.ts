import { ipcMain, dialog, BrowserWindow, shell, clipboard, nativeImage } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { basename } from 'path'
import { IPC_CHANNELS } from './channels'
import log from '../logger'
import {
  validateGalleryQuery,
  validatePromptVariants,
  validateSettingsKey,
  validateString,
  validateId,
  validateRating,
  validateStringArray,
  validatePositiveInt,
  validateAbsolutePath
} from './validators'
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
import { calculateTaskCount, countTotalTasksFromData } from '../services/batch/task-generator'
import type {
  BatchConfig,
  BatchModuleSelection,
  ModuleDataSnapshot
} from '../services/batch/task-generator'
import { queueManager } from '../services/batch/queue-manager'
import { getDatabase } from '../services/database'
import { ptyManager } from '../services/terminal/pty-manager'
import { mcpServerManager } from '../services/mcp'
import {
  getMcpConfigStatus,
  writeMcpJsonConfig,
  removeMcpJsonConfig
} from '../services/mcp/config-generator'
import { isJsonObject, safeJsonParse } from '../utils/safe-json'
import { resolveDirectAssetPathFromSettings } from '../services/assets/local-asset'

const settingsRepo = new SettingsRepository()
const workflowRepo = new WorkflowRepository()
const moduleRepo = new ModuleRepository()
const moduleItemRepo = new ModuleItemRepository()
const characterRepo = new CharacterRepository()
const batchJobRepo = new BatchJobRepository()
const batchTaskRepo = new BatchTaskRepository()
const imageRepo = new GeneratedImageRepository()

interface ModuleImportPayload {
  module: {
    name: string
    type: string
    description?: string
    parent_id?: string | null
  }
  items: Array<{
    name: string
    prompt: string
    negative?: string
    weight?: number
    sort_order?: number
    metadata?: string
  }>
}

function isModuleImportPayload(value: unknown): value is ModuleImportPayload {
  if (!isJsonObject(value)) {
    return false
  }

  const { module, items } = value
  if (
    !isJsonObject(module) ||
    typeof module.name !== 'string' ||
    typeof module.type !== 'string' ||
    (module.description !== undefined && typeof module.description !== 'string') ||
    (module.parent_id !== undefined &&
      module.parent_id !== null &&
      typeof module.parent_id !== 'string')
  ) {
    return false
  }

  if (!Array.isArray(items)) {
    return false
  }

  return items.every(
    (item) =>
      isJsonObject(item) &&
      typeof item.name === 'string' &&
      typeof item.prompt === 'string' &&
      (item.negative === undefined || typeof item.negative === 'string') &&
      (item.weight === undefined || typeof item.weight === 'number') &&
      (item.sort_order === undefined || typeof item.sort_order === 'number') &&
      (item.metadata === undefined || typeof item.metadata === 'string')
  )
}

export function registerIpcHandlers(): void {
  // === ComfyUI Connection ===
  ipcMain.handle(
    IPC_CHANNELS.COMFYUI_CONNECT,
    async (_event, { host, port }: { host: string; port: number }) => {
      const success = await comfyuiManager.connect(host, port)
      return success
    }
  )

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
    } catch (error) {
      log.debug('[IPC] Failed to fetch ComfyUI system stats:', error)
      return null
    }
  })

  // === Available Models ===
  ipcMain.handle('comfyui:models', async () => {
    if (!comfyuiManager.isConnected) return null
    try {
      return await comfyuiManager.restClient.getAvailableModels()
    } catch (error) {
      log.debug('[IPC] Failed to fetch ComfyUI models:', error)
      return null
    }
  })

  // === Workflow Import ===
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_IMPORT, (_event, { filePath }: { filePath: string }) => {
    try {
      const validatedPath = validateAbsolutePath(filePath, ['.json'])
      if (!existsSync(validatedPath)) {
        throw new Error('Workflow file not found')
      }

      const content = readFileSync(validatedPath, 'utf-8')
      const workflowJson = safeJsonParse<Record<string, unknown>>(content, {
        context: 'Workflow file',
        validate: isJsonObject,
        invalidShapeMessage: 'Workflow file must contain a JSON object'
      })
      if (!workflowJson.ok) {
        throw new Error(workflowJson.error)
      }

      const json = workflowJson.value
      const fileName = basename(validatedPath, '.json')

      // Detect if this is UI format or API format
      let apiJson: string
      let uiJson: string | null = null

      if (json.nodes && json.links) {
        // This is UI format - we'd need conversion, store as-is for now
        // TODO: Implement UI→API format conversion
        uiJson = content
        throw new Error(
          'UI format workflow detected. Please export in API format (Save API Format).'
        )
      } else {
        // This is API format
        apiJson = content
      }

      const parsed = parseWorkflow(apiJson, fileName)

      // Save to database
      const workflowId = workflowRepo.create({
        name: parsed.name,
        description: `Imported from ${basename(validatedPath)}`,
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

      return {
        id: workflowId,
        name: parsed.name,
        category: parsed.suggestedCategory,
        variableCount: parsed.variables.length
      }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  // === Workflow Variable Management ===
  ipcMain.handle('workflow:variables', (_event, { workflowId }: { workflowId: string }) => {
    return workflowRepo.getVariables(workflowId)
  })

  ipcMain.handle(
    'workflow:set-variables',
    (
      _event,
      {
        workflowId,
        variables
      }: {
        workflowId: string
        variables: Array<{
          node_id: string
          field_name: string
          display_name: string
          var_type: string
          default_val?: string
          description?: string
        }>
      }
    ) => {
      workflowRepo.setVariables(workflowId, variables)
      return true
    }
  )

  // Update variable role
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_ROLE,
    (_event, { variableId, role }: { variableId: string; role: string }) => {
      workflowRepo.updateVariableRole(variableId, role)
      return true
    }
  )

  // Update variable value
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_VALUE,
    (_event, { variableId, value }: { variableId: string; value: string }) => {
      workflowRepo.updateValue(variableId, value)
      return true
    }
  )

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) => {
    return settingsRepo.get(key)
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_event, { key, value }: { key: string; value: string }) => {
      validateSettingsKey(key)
      validateString(value, 10000)
      settingsRepo.set(key, value)
      return true
    }
  )

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

  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      workflowRepo.update(id, data)
      return true
    }
  )

  // Modules
  ipcMain.handle(IPC_CHANNELS.MODULE_LIST, (_event, args?: { type?: string }) => {
    return moduleRepo.list(args?.type)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_GET, (_event, { id }: { id: string }) => {
    return moduleRepo.get(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.MODULE_CREATE,
    (_event, data: { name: string; type: string; description?: string; parent_id?: string }) => {
      return moduleRepo.create(data)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.MODULE_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      moduleRepo.update(id, data)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.MODULE_DELETE, (_event, { id }: { id: string }) => {
    moduleRepo.delete(id)
    return true
  })

  // Module Items
  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_LIST, (_event, { moduleId }: { moduleId: string }) => {
    const items = moduleItemRepo.list(moduleId)
    return items.map((item) => ({
      ...item,
      prompt_variants: validatePromptVariants(item.prompt_variants as string)
    }))
  })

  ipcMain.handle(
    IPC_CHANNELS.MODULE_ITEM_CREATE,
    (
      _event,
      data: {
        module_id: string
        name: string
        prompt: string
        negative?: string
        weight?: number
        sort_order?: number
        metadata?: string
        prompt_variants?: Record<string, { prompt: string; negative: string }> | string
      }
    ) => {
      const pv = data.prompt_variants
      const serialized = typeof pv === 'string' ? pv : pv ? JSON.stringify(pv) : '{}'
      return moduleItemRepo.create({ ...data, prompt_variants: serialized })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.MODULE_ITEM_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      moduleItemRepo.update(id, data)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_DELETE, (_event, { id }: { id: string }) => {
    moduleItemRepo.delete(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_REORDER, (_event, { itemIds }: { itemIds: string[] }) => {
    validateStringArray(itemIds)
    moduleItemRepo.reorder(itemIds)
    return true
  })

  // Characters
  ipcMain.handle(IPC_CHANNELS.CHARACTER_LIST, () => {
    return characterRepo.list()
  })

  ipcMain.handle(IPC_CHANNELS.CHARACTER_GET, (_event, { id }: { id: string }) => {
    return characterRepo.get(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.CHARACTER_CREATE,
    (
      _event,
      data: { name: string; base_prompt: string; negative_prompt?: string; metadata?: string }
    ) => {
      return characterRepo.create(data)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CHARACTER_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      characterRepo.update(id, data)
      return true
    }
  )

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

  ipcMain.handle(IPC_CHANNELS.BATCH_REORDER, (_event, { jobIds }: { jobIds: string[] }) => {
    validateStringArray(jobIds)
    batchJobRepo.reorder(jobIds)
    return true
  })

  ipcMain.handle('batch:delete-tasks', (_event, { jobId }: { jobId: string }) => {
    batchTaskRepo.deleteByJob(jobId)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BATCH_RERUN, (_event, { id }: { id: string }) => {
    if (queueManager.isProcessing) {
      return { success: false, error: 'Queue is already processing a job' }
    }
    // Delete old task rows and reset progress before starting
    batchTaskRepo.deleteByJob(id)
    batchJobRepo.updateProgress(id, 0, 0)
    batchJobRepo.updateStatus(id, 'draft')
    // Fire-and-forget so renderer gets immediate response
    queueManager.startJob(id).catch((err) => {
      log.error('[QueueManager] Rerun job error:', err)
    })
    return { success: true }
  })

  // Batch task count preview
  ipcMain.handle(
    'batch:preview-count',
    (
      _event,
      {
        moduleSelections,
        countPerCombination
      }: { moduleSelections: BatchModuleSelection[]; countPerCombination: number }
    ) => {
      return calculateTaskCount(moduleSelections, countPerCombination)
    }
  )

  // Create batch job and expand to tasks
  ipcMain.handle(IPC_CHANNELS.BATCH_CREATE, (_event, config: BatchConfig) => {
    // Resolve prefix module IDs to composed text
    if (config.slotMappings) {
      for (const slot of config.slotMappings) {
        // Preserve original user-entered prefixText before mutation (for edit/copy restoration)
        slot.userPrefixText = slot.prefixText || ''

        if (slot.action === 'inject' && slot.prefixModuleIds && slot.prefixModuleIds.length > 0) {
          const prefixModules = slot.prefixModuleIds
            .map((moduleId) => {
              const mod = moduleRepo.get(moduleId)
              const items = moduleItemRepo.list(moduleId)
              return {
                type: (mod?.type as string) || 'custom',
                items: items
                  .filter((item) => (item.enabled as number) !== 0)
                  .map((item) => {
                    // Resolve prompt variant if slot specifies one
                    const variants = validatePromptVariants(item.prompt_variants as string)
                    const variant = slot.promptVariant ? variants[slot.promptVariant] : undefined
                    return {
                      prompt: variant?.prompt ?? (item.prompt as string),
                      negative: variant?.negative ?? ((item.negative as string) || ''),
                      weight: (item.weight as number) || 1.0,
                      enabled: true
                    }
                  })
              }
            })
            .filter((m) => m.items.length > 0)

          if (prefixModules.length > 0) {
            const composed = buildPrompt(prefixModules)
            const composedText =
              slot.role === 'prompt_positive' ? composed.positive : composed.negative
            if (composedText.trim()) {
              slot.prefixText =
                composedText.trim() + (slot.prefixText?.trim() ? ', ' + slot.prefixText.trim() : '')
            }
          }
        }
      }
    }

    // Load module data for snapshot (freeze current state so deleted items won't break job)
    const moduleData: ModuleDataSnapshot = config.moduleSelections.map((sel) => {
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
          enabled: (item.enabled as number) !== 0,
          prompt_variants: validatePromptVariants(item.prompt_variants as string)
        }))
      }
    })

    // Calculate total task count without generating tasks
    const totalTasks = countTotalTasksFromData(config, moduleData)

    // Store resolved config (with prefix text already composed) for lazy expansion
    const resolvedConfigJson = JSON.stringify(config)

    // Create the job with module data snapshot — NO task rows created
    const jobId = batchJobRepo.create({
      name: config.name,
      description: config.description,
      config: resolvedConfigJson,
      workflow_id: config.workflowId,
      total_tasks: totalTasks,
      pipeline_config: config.pipelineConfig ? JSON.stringify(config.pipelineConfig) : undefined,
      module_data_snapshot: JSON.stringify(moduleData)
    })

    return { jobId, totalTasks }
  })

  // Get tasks for a batch job
  ipcMain.handle('batch:tasks', (_event, { jobId }: { jobId: string }) => {
    return batchTaskRepo.listByJob(jobId)
  })

  // Queue execution control — fire-and-forget so renderer gets immediate response
  ipcMain.handle(IPC_CHANNELS.BATCH_START, (_event, { id }: { id: string }) => {
    if (queueManager.isProcessing) {
      return { success: false, error: 'Queue is already processing a job' }
    }
    queueManager.startJob(id).catch((err) => {
      log.error('[QueueManager] Job execution error:', err)
    })
    return { success: true }
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
    return imageRepo.list(validateGalleryQuery(query))
  })

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_RATE,
    (_event, { id, rating }: { id: string; rating: number }) => {
      validateId(id)
      validateRating(rating)
      imageRepo.updateRating(id, rating)
      return true
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_FAVORITE,
    (_event, { id, favorite }: { id: string; favorite: boolean }) => {
      imageRepo.updateFavorite(id, favorite)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.GALLERY_DELETE, (_event, { ids }: { ids: string[] }) => {
    validateStringArray(ids)
    imageRepo.delete(ids)
    return true
  })

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_COPY_CLIPBOARD,
    (_event, { filePath }: { filePath: string }) => {
      try {
        const validatedPath = validateAbsolutePath(filePath)
        const allowedPath = resolveDirectAssetPathFromSettings(validatedPath, {
          settings: settingsRepo,
          resolverDeps: {
            isTrackedAssetPath: (candidatePaths) => imageRepo.hasTrackedAssetPath(candidatePaths)
          }
        })

        if (!allowedPath) return { success: false, error: 'Forbidden path' }
        if (!existsSync(allowedPath)) return { success: false, error: 'File not found' }

        const img = nativeImage.createFromPath(allowedPath)
        if (img.isEmpty()) return { success: false, error: 'Failed to load image' }
        clipboard.writeImage(img)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_SHOW_IN_EXPLORER,
    (_event, { filePath }: { filePath: string }) => {
      const validatedPath = validateAbsolutePath(filePath)
      const allowedPath = resolveDirectAssetPathFromSettings(validatedPath, {
        settings: settingsRepo,
        resolverDeps: {
          isTrackedAssetPath: (candidatePaths) => imageRepo.hasTrackedAssetPath(candidatePaths)
        }
      })

      if (!allowedPath || !existsSync(allowedPath)) return false
      shell.showItemInFolder(allowedPath)
      return true
    }
  )

  // Prompt Preview
  ipcMain.handle(
    'prompt:preview',
    (
      _event,
      { moduleIds, variables }: { moduleIds: string[]; variables?: Record<string, string> }
    ) => {
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
    }
  )

  // Module import/export
  ipcMain.handle('module:export', (_event, { moduleId }: { moduleId: string }) => {
    const mod = moduleRepo.get(moduleId)
    if (!mod) return null
    const items = moduleItemRepo.list(moduleId)
    return JSON.stringify({ module: mod, items }, null, 2)
  })

  ipcMain.handle('module:import-data', (_event, { jsonData }: { jsonData: string }) => {
    try {
      const dataResult = safeJsonParse<ModuleImportPayload>(jsonData, {
        context: 'Module import data',
        validate: isModuleImportPayload,
        invalidShapeMessage: 'Invalid module export format'
      })
      if (!dataResult.ok) {
        throw new Error(dataResult.error)
      }

      const data = dataResult.value
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

    const favCountStmt = db.prepare(
      'SELECT COUNT(*) as count FROM generated_images WHERE is_favorite = 1'
    )
    favCountStmt.step()
    const favoriteCount = (favCountStmt.getAsObject() as { count: number }).count
    favCountStmt.free()

    const jobCountStmt = db.prepare('SELECT COUNT(*) as count FROM batch_jobs')
    jobCountStmt.step()
    const totalJobs = (jobCountStmt.getAsObject() as { count: number }).count
    jobCountStmt.free()

    const completedJobsStmt = db.prepare(
      "SELECT COUNT(*) as count FROM batch_jobs WHERE status = 'completed'"
    )
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
    const recentStmt = db.prepare(
      'SELECT id, file_path, character_name, emotion_name, created_at FROM generated_images ORDER BY created_at DESC LIMIT 10'
    )
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
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_OPEN_FILE,
    async (_event, args?: { filters?: { name: string; extensions: string[] }[] }) => {
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
    }
  )

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // === Terminal ===
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CREATE,
    (_event, { cols, rows }: { cols: number; rows: number }) => {
      validatePositiveInt(cols)
      validatePositiveInt(rows)
      return ptyManager.create(cols, rows)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_INPUT,
    (_event, { id, data }: { id: string; data: string }) => {
      ptyManager.write(id, data)
      return true
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RESIZE,
    (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      ptyManager.resize(id, cols, rows)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.TERMINAL_DESTROY, (_event, { id }: { id: string }) => {
    ptyManager.destroy(id)
    return true
  })

  // === MCP Server ===
  ipcMain.handle(IPC_CHANNELS.MCP_START, async (_event, { port }: { port?: number }) => {
    try {
      await mcpServerManager.start(port)
      return { success: true, url: mcpServerManager.url, port: mcpServerManager.port }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_STOP, async () => {
    await mcpServerManager.stop()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.MCP_STATUS, () => {
    return {
      isRunning: mcpServerManager.isRunning,
      port: mcpServerManager.port,
      url: mcpServerManager.url
    }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_CONFIG_STATUS, () => {
    return getMcpConfigStatus()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SETUP_CLI, (_event, { targetDir }: { targetDir?: string }) => {
    if (!mcpServerManager.isRunning) {
      return { success: false, error: 'MCP server is not running' }
    }
    try {
      const configPath = writeMcpJsonConfig(mcpServerManager.url, targetDir)
      return { success: true, configPath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_REMOVE_CLI, (_event, { targetDir }: { targetDir?: string }) => {
    try {
      const removed = removeMcpJsonConfig(targetDir)
      return { success: true, removed }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
