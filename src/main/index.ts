import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDatabase, closeDatabase } from './services/database'
import { registerIpcHandlers } from './ipc/handlers'
import { mcpServerManager } from './services/mcp'
import { ptyManager } from './services/terminal/pty-manager'
import { queueManager } from './services/batch/queue-manager'

// Register custom protocol for serving local images
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-asset',
    privileges: {
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true
    }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
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

  // Register protocol handler for local file access
  protocol.handle('local-asset', (request) => {
    // URL format: local-asset://image/<encoded-path>
    // Extract everything after 'local-asset://image/'
    const prefix = 'local-asset://image/'
    const encoded = request.url.startsWith(prefix)
      ? request.url.slice(prefix.length)
      : request.url.slice('local-asset://'.length)
    const filePath = decodeURIComponent(encoded)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  await initDatabase()

  // Recover jobs interrupted by previous crash/force-quit
  queueManager.recoverInterruptedJobs()

  // Register IPC handlers
  registerIpcHandlers()

  // Auto-start MCP server if enabled
  try {
    const { SettingsRepository } = require('./services/database/repositories')
    const settingsRepo = new SettingsRepository()
    const mcpEnabled = settingsRepo.get('mcp_enabled')
    if (mcpEnabled === 'true') {
      const mcpPort = parseInt(settingsRepo.get('mcp_port') || '39464')
      mcpServerManager.start(mcpPort).catch((err: Error) => {
        console.error('[MCP] Auto-start failed:', err.message)
      })
    }
  } catch { /* settings not ready yet */ }

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
      const { BatchJobRepository, BatchTaskRepository } = require('./services/database/repositories')
      const batchJobRepo = new BatchJobRepository()
      const batchTaskRepo = new BatchTaskRepository()
      batchTaskRepo.resetRunningTasksByJob(queueManager.currentJobId)
      batchJobRepo.updateStatus(queueManager.currentJobId, 'paused')
    }
  } catch { /* ignore */ }

  // Clean up terminal instances
  ptyManager.destroyAll()

  // Stop MCP server
  mcpServerManager.stop().catch(() => {})

  // Disconnect from ComfyUI and save database
  try {
    const { comfyuiManager } = require('./services/comfyui/manager')
    comfyuiManager.disconnect()
  } catch { /* ignore */ }
  closeDatabase()
})
