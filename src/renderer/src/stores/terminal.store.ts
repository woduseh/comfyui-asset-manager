import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface TerminalTab {
  id: string
  title: string
}

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<TerminalTab[]>([])
  const activeTabId = ref<string | null>(null)
  const panelVisible = ref(false)
  const panelHeight = ref(300)
  const mcpStatus = ref<{ isRunning: boolean; port: number; url: string }>({
    isRunning: false,
    port: 39464,
    url: 'http://localhost:39464/mcp'
  })
  const mcpConfigStatus = ref<{
    claudeCode: boolean
    copilotCli: boolean
    geminiCli: boolean
    codexCli: boolean
    configPath: string
  }>({
    claudeCode: false,
    copilotCli: false,
    geminiCli: false,
    codexCli: false,
    configPath: ''
  })

  async function createTab(): Promise<string> {
    const terminalId = await window.electron.ipcRenderer.invoke('terminal:create', {
      cols: 80,
      rows: 24
    })
    const tab: TerminalTab = {
      id: terminalId,
      title: `Terminal ${tabs.value.length + 1}`
    }
    tabs.value.push(tab)
    activeTabId.value = terminalId

    // Auto-start MCP server when first terminal is created
    if (!mcpStatus.value.isRunning) {
      await startMcpServer(mcpStatus.value.port)
      // Persist the enabled state so it auto-starts on next app launch
      await window.electron.ipcRenderer.invoke('settings:set', {
        key: 'mcp_enabled',
        value: 'true'
      })
    }

    return terminalId
  }

  async function closeTab(id: string): Promise<void> {
    await window.electron.ipcRenderer.invoke('terminal:destroy', { id })
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
    const status = await window.electron.ipcRenderer.invoke('mcp:status')
    mcpStatus.value = status
    await fetchMcpConfigStatus()
  }

  async function fetchMcpConfigStatus(): Promise<void> {
    const status = await window.electron.ipcRenderer.invoke('mcp:config-status')
    mcpConfigStatus.value = status
  }

  async function startMcpServer(
    port?: number
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    const result = await window.electron.ipcRenderer.invoke('mcp:start', { port })
    if (result.success) {
      mcpStatus.value = { isRunning: true, port: result.port, url: result.url }
      await fetchMcpConfigStatus()
    }
    return result
  }

  async function stopMcpServer(): Promise<void> {
    await window.electron.ipcRenderer.invoke('mcp:stop')
    mcpStatus.value = { ...mcpStatus.value, isRunning: false }
    await fetchMcpConfigStatus()
  }

  async function setupMcpForCli(
    targetDir?: string
  ): Promise<{ success: boolean; configPath?: string; error?: string }> {
    const result = await window.electron.ipcRenderer.invoke('mcp:setup-cli', { targetDir })
    if (result.success) {
      await fetchMcpConfigStatus()
    }
    return result
  }

  async function removeMcpFromCli(targetDir?: string): Promise<{ success: boolean }> {
    const result = await window.electron.ipcRenderer.invoke('mcp:remove-cli', { targetDir })
    await fetchMcpConfigStatus()
    return result
  }

  return {
    tabs,
    activeTabId,
    panelVisible,
    panelHeight,
    mcpStatus,
    mcpConfigStatus,
    createTab,
    closeTab,
    setActiveTab,
    togglePanel,
    showPanel,
    hidePanel,
    fetchMcpStatus,
    fetchMcpConfigStatus,
    startMcpServer,
    stopMcpServer,
    setupMcpForCli,
    removeMcpFromCli
  }
})
