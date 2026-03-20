<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalStore } from '@renderer/stores/terminal.store'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  terminalId: string
  active: boolean
}>()

const terminalStore = useTerminalStore()
const terminalRef = ref<HTMLDivElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let dataListener: ((event: unknown, payload: { id: string; data: string }) => void) | null = null
let exitListener: ((event: unknown, payload: { id: string; exitCode: number }) => void) | null = null
let resizeObserver: ResizeObserver | null = null

function writeMcpBanner(): void {
  if (!terminal) return
  const mcp = terminalStore.mcpStatus
  if (mcp.isRunning) {
    terminal.write('\x1b[38;5;117m╭─ MCP Server ─────────────────────────────────╮\x1b[0m\r\n')
    terminal.write(`\x1b[38;5;117m│\x1b[0m  \x1b[32m●\x1b[0m URL: \x1b[1m${mcp.url}\x1b[0m\r\n`)
    terminal.write(`\x1b[38;5;117m│\x1b[0m  \x1b[36menv:\x1b[0m $COMFYUI_MCP_URL \x1b[90m(auto-injected)\x1b[0m\r\n`)
    if (terminalStore.mcpConfigStatus.claudeCode) {
      terminal.write(`\x1b[38;5;117m│\x1b[0m  \x1b[35mClaude Code:\x1b[0m \x1b[32mconfigured ✓\x1b[0m\r\n`)
    }
    terminal.write('\x1b[38;5;117m╰──────────────────────────────────────────────╯\x1b[0m\r\n\r\n')
  }
}

onMounted(() => {
  if (!terminalRef.value) return

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#45475a',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8'
    },
    allowTransparency: true,
    scrollback: 5000
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  terminal.open(terminalRef.value)

  nextTick(() => {
    fitAddon!.fit()
    writeMcpBanner()
  })

  // Send input to PTY
  terminal.onData((data: string) => {
    window.electron.ipcRenderer.invoke('terminal:input', {
      id: props.terminalId,
      data
    })
  })

  // Receive output from PTY
  dataListener = (_event: unknown, payload: { id: string; data: string }) => {
    if (payload.id === props.terminalId && terminal) {
      terminal.write(payload.data)
    }
  }
  window.electron.ipcRenderer.on('terminal:data', dataListener as (...args: unknown[]) => void)

  exitListener = (_event: unknown, payload: { id: string; exitCode: number }) => {
    if (payload.id === props.terminalId && terminal) {
      terminal.write(`\r\n\x1b[33m[Process exited with code ${payload.exitCode}]\x1b[0m\r\n`)
    }
  }
  window.electron.ipcRenderer.on('terminal:exit', exitListener as (...args: unknown[]) => void)

  // Auto-resize
  resizeObserver = new ResizeObserver(() => {
    if (props.active && fitAddon) {
      fitAddon.fit()
      if (terminal) {
        window.electron.ipcRenderer.invoke('terminal:resize', {
          id: props.terminalId,
          cols: terminal.cols,
          rows: terminal.rows
        })
      }
    }
  })
  resizeObserver.observe(terminalRef.value)
})

// Re-fit when tab becomes active
watch(() => props.active, (isActive) => {
  if (isActive && fitAddon) {
    nextTick(() => {
      fitAddon!.fit()
      terminal?.focus()
    })
  }
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  if (dataListener) {
    window.electron.ipcRenderer.removeListener('terminal:data', dataListener as (...args: unknown[]) => void)
  }
  if (exitListener) {
    window.electron.ipcRenderer.removeListener('terminal:exit', exitListener as (...args: unknown[]) => void)
  }
  terminal?.dispose()
})
</script>

<template>
  <div
    ref="terminalRef"
    class="terminal-instance"
    :style="{ display: active ? 'block' : 'none' }"
  />
</template>

<style scoped>
.terminal-instance {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-instance :deep(.xterm) {
  height: 100%;
  padding: 4px;
}
</style>
