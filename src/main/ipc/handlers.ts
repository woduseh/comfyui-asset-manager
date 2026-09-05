import { ipcMain, dialog, BrowserWindow, shell, clipboard, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import log from '../logger'
import {
  validateGalleryQuery,
  validatePromptVariants,
  validateSettingsKey,
  validateString,
  validateId,
  validateRating,
  validateStringArray,
  validateAbsolutePath,
  validateBoolean,
  validateCharacterData,
  validateIntegerRange,
  validateModuleData,
  validateModuleItemData,
  validateModuleType,
  validateTerminalDimensions,
  validateTerminalInput,
  validateWorkflowCategory,
  validateWorkflowRole,
  validateWorkflowUpdate,
  validateWorkflowVariables
} from './validators'
import {
  SettingsRepository,
  WorkflowRepository,
  ModuleRepository,
  ModuleItemRepository,
  CharacterRepository,
  GeneratedImageRepository
} from '../services/database/repositories'
import { comfyuiManager } from '../services/comfyui/manager'
import { importWorkflowFromSelectedPath } from '../services/comfyui/workflow-import'
import { previewPrompt } from '../services/prompt/composition-engine'
import { getDatabase, withTransaction } from '../services/database'
import { ptyManager } from '../services/terminal/pty-manager'
import { mcpServerManager } from '../services/mcp'
import {
  getMcpConfigStatus,
  writeMcpJsonConfig,
  removeMcpJsonConfig
} from '../services/mcp/config-generator'
import {
  getOrCreateMcpAuthConfig,
  rotateMcpAuthToken,
  setMcpAuthRequired
} from '../services/mcp/auth'
import { isJsonObject, safeJsonParse } from '@shared/safe-json'
import { resolveDirectAssetPathFromSettings } from '../services/assets/local-asset'
import { registerBatchHandlers } from './handlers/batch'

const settingsRepo = new SettingsRepository()
const workflowRepo = new WorkflowRepository()
const moduleRepo = new ModuleRepository()
const moduleItemRepo = new ModuleItemRepository()
const characterRepo = new CharacterRepository()
const imageRepo = new GeneratedImageRepository()

interface ModuleImportPayload {
  module: Parameters<ModuleRepository['create']>[0]
  items: Array<
    Omit<Parameters<ModuleItemRepository['create']>[0], 'module_id'> & { enabled?: number }
  >
}

function validateModuleImportPayload(value: unknown): ModuleImportPayload {
  if (!isJsonObject(value) || !isJsonObject(value.module) || !Array.isArray(value.items)) {
    throw new Error('Invalid module export format')
  }

  // Exported records contain database-owned columns; import only editable content into new IDs.
  const module = {
    name: value.module.name,
    type: value.module.type,
    description: value.module.description ?? '',
    parent_id: value.module.parent_id ?? undefined
  }
  validateModuleData(module)

  const items = value.items.map((raw) => {
    if (!isJsonObject(raw) || raw.name === undefined || raw.prompt === undefined) {
      throw new Error('Invalid module export item')
    }
    const item = {
      name: raw.name,
      prompt: raw.prompt,
      negative: raw.negative,
      weight: raw.weight,
      sort_order: raw.sort_order,
      metadata: raw.metadata,
      enabled: raw.enabled,
      prompt_variants:
        typeof raw.prompt_variants === 'string'
          ? raw.prompt_variants
          : JSON.stringify(raw.prompt_variants)
    }
    validateModuleItemData(item, true)
    return item
  })
  return { module, items } as ModuleImportPayload
}

export function registerIpcHandlers(): void {
  // === ComfyUI Connection ===
  ipcMain.handle(
    IPC_CHANNELS.COMFYUI_CONNECT,
    async (_event, { host, port }: { host: string; port: number }) => {
      validateString(host, 255)
      validateIntegerRange(port, 1, 65_535, 'ComfyUI port')
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
  ipcMain.handle(IPC_CHANNELS.COMFYUI_MODELS, async () => {
    if (!comfyuiManager.isConnected) return null
    try {
      return await comfyuiManager.restClient.getAvailableModels()
    } catch (error) {
      log.debug('[IPC] Failed to fetch ComfyUI models:', error)
      return null
    }
  })

  // === Workflow Import ===
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_IMPORT, async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const selection = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      })
      if (selection.canceled || selection.filePaths.length === 0) return null
      return importWorkflowFromSelectedPath(selection.filePaths[0], workflowRepo)
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  // === Workflow Variable Management ===
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_VARIABLES,
    (_event, { workflowId }: { workflowId: string }) => {
      validateId(workflowId)
      return workflowRepo.getVariables(workflowId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_SET_VARIABLES,
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
      validateId(workflowId)
      validateWorkflowVariables(variables)
      workflowRepo.setVariables(workflowId, variables)
      return true
    }
  )

  // Update variable role
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_ROLE,
    (_event, { variableId, role }: { variableId: string; role: string }) => {
      validateId(variableId)
      validateWorkflowRole(role)
      workflowRepo.updateVariableRole(variableId, role)
      return true
    }
  )

  // Update variable value
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE_VARIABLE_VALUE,
    (_event, { variableId, value }: { variableId: string; value: string }) => {
      validateId(variableId)
      validateString(value, 100_000)
      workflowRepo.updateValue(variableId, value)
      return true
    }
  )

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) => {
    validateSettingsKey(key)
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
    if (args?.category !== undefined) validateWorkflowCategory(args.category)
    return workflowRepo.list(args?.category)
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_GET, (_event, { id }: { id: string }) => {
    validateId(id)
    return workflowRepo.get(id)
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_DELETE, (_event, { id }: { id: string }) => {
    validateId(id)
    workflowRepo.delete(id)
    return true
  })

  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      validateId(id)
      validateWorkflowUpdate(data)
      workflowRepo.update(id, data)
      return true
    }
  )

  // Modules
  ipcMain.handle(IPC_CHANNELS.MODULE_LIST, (_event, args?: { type?: string }) => {
    if (args?.type !== undefined) validateModuleType(args.type)
    return moduleRepo.list(args?.type)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_GET, (_event, { id }: { id: string }) => {
    validateId(id)
    return moduleRepo.get(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.MODULE_CREATE,
    (_event, data: { name: string; type: string; description?: string; parent_id?: string }) => {
      validateModuleData(data)
      return moduleRepo.create(data)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.MODULE_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      validateId(id)
      validateModuleData(data, true)
      moduleRepo.update(id, data)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.MODULE_DELETE, (_event, { id }: { id: string }) => {
    validateId(id)
    moduleRepo.delete(id)
    return true
  })

  // Module Items
  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_LIST, (_event, { moduleId }: { moduleId: string }) => {
    validateId(moduleId)
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
      validateModuleItemData(data)
      const pv = data.prompt_variants
      const serialized = typeof pv === 'string' ? pv : pv ? JSON.stringify(pv) : '{}'
      return moduleItemRepo.create({ ...data, prompt_variants: serialized })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.MODULE_ITEM_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      validateId(id)
      validateModuleItemData(data, true)
      moduleItemRepo.update(id, data)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.MODULE_ITEM_DELETE, (_event, { id }: { id: string }) => {
    validateId(id)
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
    validateId(id)
    return characterRepo.get(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.CHARACTER_CREATE,
    (
      _event,
      data: { name: string; base_prompt: string; negative_prompt?: string; metadata?: string }
    ) => {
      validateCharacterData(data)
      return characterRepo.create(data)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CHARACTER_UPDATE,
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      validateId(id)
      validateCharacterData(data, true)
      characterRepo.update(id, data)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.CHARACTER_DELETE, (_event, { id }: { id: string }) => {
    validateId(id)
    characterRepo.delete(id)
    return true
  })

  registerBatchHandlers()

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
      validateId(id)
      validateBoolean(favorite)
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
    IPC_CHANNELS.PROMPT_PREVIEW,
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
  ipcMain.handle(IPC_CHANNELS.MODULE_EXPORT, (_event, { moduleId }: { moduleId: string }) => {
    validateId(moduleId)
    const mod = moduleRepo.get(moduleId)
    if (!mod) return null
    const items = moduleItemRepo.list(moduleId)
    return JSON.stringify({ module: mod, items }, null, 2)
  })

  ipcMain.handle(IPC_CHANNELS.MODULE_IMPORT_DATA, (_event, { jsonData }: { jsonData: string }) => {
    try {
      validateString(jsonData, 1_048_576)
      const dataResult = safeJsonParse(jsonData, { context: 'Module import data' })
      if (!dataResult.ok) {
        throw new Error(dataResult.error)
      }

      const data = validateModuleImportPayload(dataResult.value)

      return withTransaction(() => {
        const modId = moduleRepo.create({
          ...data.module,
          name: data.module.name + ' (imported)'
        })
        for (const { enabled, ...item } of data.items) {
          const itemId = moduleItemRepo.create({ ...item, module_id: modId })
          if (enabled === 0) moduleItemRepo.update(itemId, { enabled })
        }
        return { id: modId, name: data.module.name }
      })
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  // Dashboard statistics
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_STATS, () => {
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
      validateTerminalDimensions(cols, rows)
      return ptyManager.create(cols, rows)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_INPUT,
    (_event, { id, data }: { id: string; data: string }) => {
      validateTerminalInput(id, data)
      ptyManager.write(id, data)
      return true
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RESIZE,
    (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      validateId(id)
      validateTerminalDimensions(cols, rows)
      ptyManager.resize(id, cols, rows)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.TERMINAL_DESTROY, (_event, { id }: { id: string }) => {
    validateId(id)
    ptyManager.destroy(id)
    return true
  })

  // === MCP Server ===
  ipcMain.handle(IPC_CHANNELS.MCP_START, async (_event, { port }: { port?: number }) => {
    try {
      if (port !== undefined) validateIntegerRange(port, 1, 65_535, 'MCP port')
      const auth = getOrCreateMcpAuthConfig(settingsRepo)
      await mcpServerManager.start(port, auth)
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
      url: mcpServerManager.url,
      authRequired: mcpServerManager.authRequired
    }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_AUTH_STATUS, () => {
    return getOrCreateMcpAuthConfig(settingsRepo)
  })

  ipcMain.handle(
    IPC_CHANNELS.MCP_AUTH_SET_REQUIRED,
    (_event, { required }: { required: boolean }) => {
      if (typeof required !== 'boolean') {
        throw new Error('Expected boolean')
      }
      const auth = setMcpAuthRequired(required, settingsRepo)
      mcpServerManager.updateAuth(auth)
      return auth
    }
  )

  ipcMain.handle(IPC_CHANNELS.MCP_AUTH_ROTATE, () => {
    const auth = rotateMcpAuthToken(settingsRepo)
    mcpServerManager.updateAuth(auth)
    return auth
  })

  ipcMain.handle(IPC_CHANNELS.MCP_CONFIG_STATUS, () => {
    const auth = getOrCreateMcpAuthConfig(settingsRepo)
    return getMcpConfigStatus(auth.token, auth.required)
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SETUP_CLI, () => {
    if (!mcpServerManager.isRunning) {
      return { success: false, error: 'MCP server is not running' }
    }
    try {
      const auth = getOrCreateMcpAuthConfig(settingsRepo)
      const configPath = writeMcpJsonConfig(
        mcpServerManager.url,
        auth.required ? auth.token : undefined
      )
      return { success: true, configPath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_REMOVE_CLI, () => {
    try {
      const removed = removeMcpJsonConfig()
      return { success: true, removed }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
