import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from './channels'
import {
  SettingsRepository,
  WorkflowRepository,
  ModuleRepository,
  ModuleItemRepository,
  CharacterRepository,
  BatchJobRepository,
  GeneratedImageRepository
} from '../services/database/repositories'

const settingsRepo = new SettingsRepository()
const workflowRepo = new WorkflowRepository()
const moduleRepo = new ModuleRepository()
const moduleItemRepo = new ModuleItemRepository()
const characterRepo = new CharacterRepository()
const batchJobRepo = new BatchJobRepository()
const imageRepo = new GeneratedImageRepository()

export function registerIpcHandlers(): void {
  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) => {
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
