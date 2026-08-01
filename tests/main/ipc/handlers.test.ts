import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    showOpenDialog: vi.fn(),
    importWorkflowFromSelectedPath: vi.fn(),
    moduleCreate: vi.fn(() => 'module-id'),
    moduleUpdate: vi.fn(),
    workflowDelete: vi.fn(),
    workflowUpdate: vi.fn(),
    batchCreate: vi.fn(() => 'batch-id'),
    batchUpdateDraft: vi.fn(),
    batchDeleteTasks: vi.fn(),
    batchUpdateProgress: vi.fn(),
    batchUpdateStatus: vi.fn(),
    batchServiceCreate: vi.fn(() => ({ jobId: 'batch-id', totalTasks: 1 })),
    batchServiceUpdateDraft: vi.fn((id: string) => ({ jobId: id, totalTasks: 1 })),
    queuePreflight: vi.fn(() => ({ success: true })),
    queueRequestStart: vi.fn(() => ({ success: true })),
    withTransaction: vi.fn(<T>(operation: () => T) => operation()),
    terminalWrite: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    })
  },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  BrowserWindow: { getFocusedWindow: vi.fn(() => ({})) },
  shell: { showItemInFolder: vi.fn() },
  clipboard: { writeImage: vi.fn() },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => false })) }
}))

vi.mock('../../../src/main/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

vi.mock('../../../src/main/services/database/repositories', () => ({
  SettingsRepository: class {
    get = vi.fn(() => null)
    set = vi.fn()
    getAll = vi.fn(() => ({}))
  },
  WorkflowRepository: class {
    list = vi.fn(() => [])
    get = vi.fn(() => null)
    create = vi.fn(() => 'workflow-id')
    delete = mocks.workflowDelete
    update = mocks.workflowUpdate
    getVariables = vi.fn(() => [])
    setVariables = vi.fn()
    updateVariableRole = vi.fn()
    updateValue = vi.fn()
  },
  ModuleRepository: class {
    list = vi.fn(() => [])
    get = vi.fn(() => null)
    create = mocks.moduleCreate
    update = mocks.moduleUpdate
    delete = vi.fn()
  },
  ModuleItemRepository: class {
    list = vi.fn(() => [])
    create = vi.fn(() => 'item-id')
    update = vi.fn()
    delete = vi.fn()
    reorder = vi.fn()
  },
  CharacterRepository: class {
    list = vi.fn(() => [])
    get = vi.fn(() => null)
    create = vi.fn(() => 'character-id')
    update = vi.fn()
    delete = vi.fn()
  },
  BatchJobRepository: class {
    list = vi.fn(() => [])
    get = vi.fn(() => null)
    create = mocks.batchCreate
    updateDraft = mocks.batchUpdateDraft
    delete = vi.fn()
    reorder = vi.fn()
    updateProgress = mocks.batchUpdateProgress
    updateStatus = mocks.batchUpdateStatus
  },
  BatchTaskRepository: class {
    listByJob = vi.fn(() => [])
    deleteByJob = mocks.batchDeleteTasks
  },
  GeneratedImageRepository: class {
    list = vi.fn(() => ({ items: [], total: 0 }))
    updateRating = vi.fn()
    updateFavorite = vi.fn()
    delete = vi.fn()
    hasTrackedAssetPath = vi.fn(() => false)
  }
}))

vi.mock('../../../src/main/services/comfyui/manager', () => ({
  comfyuiManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: false,
    clientId: 'client-id'
  }
}))

vi.mock('../../../src/main/services/comfyui/workflow-import', () => ({
  importWorkflowFromSelectedPath: mocks.importWorkflowFromSelectedPath
}))

vi.mock('../../../src/main/services/batch/queue-manager', () => ({
  queueManager: {
    isProcessing: false,
    isPaused: false,
    currentJobId: null,
    startJob: vi.fn(),
    preflightStart: mocks.queuePreflight,
    requestStart: mocks.queueRequestStart,
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn()
  }
}))

vi.mock('../../../src/main/services/batch/batch-job-service', () => ({
  batchJobService: {
    create: mocks.batchServiceCreate,
    updateDraft: mocks.batchServiceUpdateDraft
  }
}))

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: vi.fn(),
  withTransaction: mocks.withTransaction
}))

vi.mock('../../../src/main/services/terminal/pty-manager', () => ({
  ptyManager: {
    create: vi.fn(() => 'terminal-id'),
    write: mocks.terminalWrite,
    resize: vi.fn(),
    destroy: vi.fn()
  }
}))

vi.mock('../../../src/main/services/mcp', () => ({
  mcpServerManager: {
    isRunning: false,
    port: 39464,
    url: 'http://localhost:39464/mcp',
    authRequired: true,
    start: vi.fn(),
    stop: vi.fn(),
    updateAuth: vi.fn()
  }
}))

vi.mock('../../../src/main/services/mcp/config-generator', () => ({
  getMcpConfigStatus: vi.fn(() => ({})),
  writeMcpJsonConfig: vi.fn(),
  removeMcpJsonConfig: vi.fn()
}))

vi.mock('../../../src/main/services/mcp/auth', () => ({
  getOrCreateMcpAuthConfig: vi.fn(() => ({ required: true, token: 'token' })),
  rotateMcpAuthToken: vi.fn(),
  setMcpAuthRequired: vi.fn()
}))

vi.mock('../../../src/main/services/assets/local-asset', () => ({
  resolveDirectAssetPathFromSettings: vi.fn(() => null)
}))

import { registerIpcHandlers } from '../../../src/main/ipc/handlers'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler
}

describe('registerIpcHandlers validation boundary', () => {
  beforeAll(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps workflow selection and path consumption in the main process', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await getHandler(IPC_CHANNELS.WORKFLOW_IMPORT)({})

    expect(result).toBeNull()
    expect(mocks.importWorkflowFromSelectedPath).not.toHaveBeenCalled()
  })

  it('imports only the path returned by the main-process file picker', async () => {
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\selected\\workflow.json']
    })
    mocks.importWorkflowFromSelectedPath.mockReturnValue({
      id: 'workflow-id',
      name: 'Workflow',
      category: 'generation',
      variableCount: 1
    })

    const result = await getHandler(IPC_CHANNELS.WORKFLOW_IMPORT)({})

    expect(mocks.importWorkflowFromSelectedPath).toHaveBeenCalledWith(
      'C:\\selected\\workflow.json',
      expect.any(Object)
    )
    expect(result).toMatchObject({ id: 'workflow-id' })
  })

  it('rejects malformed module creates before repository mutation', () => {
    const handler = getHandler(IPC_CHANNELS.MODULE_CREATE)

    expect(() => handler({}, { name: 'Module', type: 'root' })).toThrow('module type')
    expect(mocks.moduleCreate).not.toHaveBeenCalled()

    expect(handler({}, { name: 'Module', type: 'custom' })).toBe('module-id')
    expect(mocks.moduleCreate).toHaveBeenCalledOnce()
  })

  it('rejects unknown update fields before repository mutation', () => {
    const handler = getHandler(IPC_CHANNELS.WORKFLOW_UPDATE)

    expect(() => handler({}, { id: 'workflow-id', data: { owner: 'root' } })).toThrow(
      'Unknown workflow update field'
    )
    expect(mocks.workflowUpdate).not.toHaveBeenCalled()
  })

  it('rejects malformed destructive IDs before repository mutation', () => {
    const handler = getHandler(IPC_CHANNELS.WORKFLOW_DELETE)

    expect(() => handler({}, { id: '../workflow' })).toThrow('Invalid ID')
    expect(mocks.workflowDelete).not.toHaveBeenCalled()
  })

  it('delegates batch creation to the shared lazy service', () => {
    const handler = getHandler(IPC_CHANNELS.BATCH_CREATE)
    const config = {
      name: 'Batch',
      workflowId: 'workflow-id',
      moduleSelections: [],
      countPerCombination: 1,
      seedMode: 'random',
      outputFolderPattern: '{job}',
      fileNamePattern: '{index}'
    }

    expect(handler({}, config)).toEqual({ jobId: 'batch-id', totalTasks: 1 })
    expect(mocks.batchServiceCreate).toHaveBeenCalledWith(config)
  })

  it('validates draft batch updates before replacing persisted configuration', () => {
    const handler = getHandler(IPC_CHANNELS.BATCH_UPDATE_DRAFT)
    const config = {
      name: 'Batch',
      workflowId: 'workflow-id',
      moduleSelections: [],
      countPerCombination: 1,
      seedMode: 'random',
      outputFolderPattern: '{job}',
      fileNamePattern: '{index}'
    }

    expect(() => handler({}, { id: '../job', config })).toThrow('Invalid ID')
    expect(mocks.batchUpdateDraft).not.toHaveBeenCalled()

    expect(handler({}, { id: 'job-id', config })).toEqual({ jobId: 'job-id', totalTasks: 1 })
    expect(mocks.batchServiceUpdateDraft).toHaveBeenCalledWith('job-id', config)
  })

  it('preflights reruns before transactionally resetting persisted state', () => {
    const handler = getHandler(IPC_CHANNELS.BATCH_RERUN)

    mocks.queuePreflight.mockReturnValueOnce({ success: false, error: 'Not connected' })
    expect(handler({}, { id: 'job-id' })).toEqual({ success: false, error: 'Not connected' })
    expect(mocks.batchDeleteTasks).not.toHaveBeenCalled()
    expect(mocks.withTransaction).not.toHaveBeenCalled()

    expect(handler({}, { id: 'job-id' })).toEqual({ success: true })
    expect(mocks.queuePreflight).toHaveBeenLastCalledWith('job-id', [
      'completed',
      'failed',
      'cancelled'
    ])
    expect(mocks.withTransaction).toHaveBeenCalledOnce()
    expect(mocks.batchDeleteTasks).toHaveBeenCalledWith('job-id')
    expect(mocks.batchUpdateProgress).toHaveBeenCalledWith('job-id', 0, 0)
    expect(mocks.batchUpdateStatus).toHaveBeenCalledWith('job-id', 'draft')
    expect(mocks.queueRequestStart).toHaveBeenCalledWith('job-id')
  })

  it('rejects malformed terminal input before writing to the PTY', () => {
    const handler = getHandler(IPC_CHANNELS.TERMINAL_INPUT)

    expect(() => handler({}, { id: '../terminal', data: 'pwd\r' })).toThrow('Invalid ID')
    expect(mocks.terminalWrite).not.toHaveBeenCalled()
  })
})
