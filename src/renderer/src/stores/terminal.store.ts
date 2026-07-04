import { defineStore } from 'pinia'
import { ref } from 'vue'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { invokeIpc } from '@renderer/utils/ipc'
import type { McpAuthStatus, McpConfigStatus, McpStatus } from '@shared/ipc-contract'

export interface TerminalTab {
  id: string
  title: string
}

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<TerminalTab[]>([])
  const activeTabId = ref<string | null>(null)
  const panelVisible = ref(false)
  const panelHeight = ref(300)
  const mcpStatus = ref<McpStatus>({
    isRunning: false,
    port: 39464,
    url: 'http://localhost:39464/mcp',
    authRequired: true
  })
  const mcpAuthStatus = ref<McpAuthStatus>({
    required: true,
    token: ''
  })
  const mcpConfigStatus = ref<McpConfigStatus>({
    claudeCode: false,
    copilotCli: false,
    geminiCli: false,
    codexCli: false,
    authReady: {
      claudeCode: false,
      copilotCli: false,
      geminiCli: false,
      codexCli: false
    },
    configPath: ''
  })

  async function createTab(): Promise<string> {
    const terminalId = await invokeIpc(IPC_CHANNELS.TERMINAL_CREATE, {
      cols: 80,
      rows: 24
    })
    const tab: TerminalTab = {
      id: terminalId,
      title: `Terminal ${tabs.value.length + 1}`
    }
    tabs.value.push(tab)
    activeTabId.value = terminalId

    return terminalId
  }

  async function closeTab(id: string): Promise<void> {
    await invokeIpc(IPC_CHANNELS.TERMINAL_DESTROY, { id })
    tabs.value = tabs.value.filter((t) => t.id !== id)
    if (activeTabId.value === id) {
      activeTabId.value = tabs.value.length > 0 ? tabs.value[tabs.value.length - 1].id : null
    }
  }

  function setActiveTab(id: string): void {
    activeTabId.value = id
  }

  function togglePanel(): void {
    panelVisible.value = !panelVisible.value
    if (panelVisible.value && tabs.value.length === 0) {
      createTab()
    }
  }

  function showPanel(): void {
    panelVisible.value = true
    if (tabs.value.length === 0) {
      createTab()
    }
  }

  function hidePanel(): void {
    panelVisible.value = false
  }

  async function fetchMcpStatus(): Promise<void> {
    const status = await invokeIpc(IPC_CHANNELS.MCP_STATUS)
    mcpStatus.value = status
    await fetchMcpAuthStatus()
    await fetchMcpConfigStatus()
  }

  async function fetchMcpAuthStatus(): Promise<void> {
    mcpAuthStatus.value = await invokeIpc(IPC_CHANNELS.MCP_AUTH_STATUS)
  }

  async function fetchMcpConfigStatus(): Promise<void> {
    const status = await invokeIpc(IPC_CHANNELS.MCP_CONFIG_STATUS)
    mcpConfigStatus.value = status
  }

  async function startMcpServer(
    port?: number
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    const result = await invokeIpc(IPC_CHANNELS.MCP_START, { port })
    if (result.success) {
      mcpStatus.value = {
        isRunning: true,
        port: result.port,
        url: result.url,
        authRequired: mcpAuthStatus.value.required
      }
      await fetchMcpAuthStatus()
      await fetchMcpConfigStatus()
    }
    return result
  }

  async function stopMcpServer(): Promise<void> {
    await invokeIpc(IPC_CHANNELS.MCP_STOP)
    mcpStatus.value = { ...mcpStatus.value, isRunning: false }
    await fetchMcpConfigStatus()
  }

  async function setMcpAuthRequired(required: boolean): Promise<void> {
    mcpAuthStatus.value = await invokeIpc(IPC_CHANNELS.MCP_AUTH_SET_REQUIRED, { required })
    mcpStatus.value = { ...mcpStatus.value, authRequired: required }
    await fetchMcpConfigStatus()
  }

  async function rotateMcpAuthToken(): Promise<void> {
    mcpAuthStatus.value = await invokeIpc(IPC_CHANNELS.MCP_AUTH_ROTATE)
    await fetchMcpConfigStatus()
  }

  async function setupMcpForCli(): Promise<{
    success: boolean
    configPath?: string
    error?: string
  }> {
    const result = await invokeIpc(IPC_CHANNELS.MCP_SETUP_CLI)
    if (result.success) {
      await fetchMcpConfigStatus()
    }
    return result
  }

  async function removeMcpFromCli(): Promise<{ success: boolean }> {
    const result = await invokeIpc(IPC_CHANNELS.MCP_REMOVE_CLI)
    await fetchMcpConfigStatus()
    return result
  }

  return {
    tabs,
    activeTabId,
    panelVisible,
    panelHeight,
    mcpStatus,
    mcpAuthStatus,
    mcpConfigStatus,
    createTab,
    closeTab,
    setActiveTab,
    togglePanel,
    showPanel,
    hidePanel,
    fetchMcpStatus,
    fetchMcpAuthStatus,
    fetchMcpConfigStatus,
    startMcpServer,
    stopMcpServer,
    setMcpAuthRequired,
    rotateMcpAuthToken,
    setupMcpForCli,
    removeMcpFromCli
  }
})
