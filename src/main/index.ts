import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import log from './logger'
import { initDatabase, closeDatabase } from './services/database'
import { registerIpcHandlers } from './ipc/handlers'
import { mcpServerManager } from './services/mcp'
import { ptyManager } from './services/terminal/pty-manager'
import { queueManager } from './services/batch/queue-manager'
import { handleLocalAssetRequestFromSettings } from './services/assets/local-asset'
import {
  SettingsRepository,
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository
} from './services/database/repositories'
import { comfyuiManager } from './services/comfyui/manager'
import {
  DEFAULT_MCP_PORT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT
} from './constants'

// Register custom protocol for serving local images
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-asset',
    privileges: {
      bypassCSP: false,
      stream: true,
      supportFetchAPI: true
    }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.comfyui-asset-manager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  await initDatabase()
  const settingsRepo = new SettingsRepository()
  const imageRepo = new GeneratedImageRepository()

  // Register protocol handler for local file access
  protocol.handle('local-asset', (request) => {
    return handleLocalAssetRequestFromSettings(request.url, {
      settings: settingsRepo,
      fetchAsset: (filePath) => net.fetch(pathToFileURL(filePath).toString()),
      resolverDeps: {
        isTrackedAssetPath: (candidatePaths) => imageRepo.hasTrackedAssetPath(candidatePaths)
      }
    })
  })

  // Recover jobs interrupted by previous crash/force-quit
  queueManager.recoverInterruptedJobs()

  // Register IPC handlers
  registerIpcHandlers()

  // Auto-start MCP server only when the user explicitly enabled it in Settings.
  try {
    const mcpEnabled = settingsRepo.get('mcp_enabled')
    if (mcpEnabled === 'true') {
      const mcpPort = parseInt(settingsRepo.get('mcp_port') || String(DEFAULT_MCP_PORT))
      mcpServerManager.start(mcpPort).catch((err: Error) => {
        log.error('[MCP] Auto-start failed:', err.message)
      })
    }
  } catch (error) {
    log.debug('[MCP] Auto-start skipped while settings were unavailable:', error)
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Clean up running job state so it can be recovered on next startup
  try {
    if (queueManager.isProcessing && queueManager.currentJobId) {
      const batchJobRepo = new BatchJobRepository()
      const batchTaskRepo = new BatchTaskRepository()
      batchTaskRepo.resetRunningTasksByJob(queueManager.currentJobId)
      batchJobRepo.updateStatus(queueManager.currentJobId, 'paused')
    }
  } catch (e) {
    log.warn('[before-quit] Failed to save running job state:', e)
  }

  // Clean up terminal instances
  ptyManager.destroyAll()

  // Stop MCP server
  mcpServerManager.stop().catch((e) => {
    log.warn('[before-quit] MCP server stop failed:', e)
  })

  // Disconnect from ComfyUI and save database
  try {
    comfyuiManager.disconnect()
  } catch (e) {
    // Best-effort disconnect during quit; logging only
    log.debug('[before-quit] ComfyUI disconnect error:', e)
  }
  closeDatabase()
})
