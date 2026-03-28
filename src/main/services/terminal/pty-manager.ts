import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { homedir } from 'os'
import { IPC_CHANNELS } from '../../ipc/channels'
import { mcpServerManager } from '../mcp'

interface TerminalInstance {
  pty: pty.IPty
  id: string
}

class PtyManager {
  private terminals = new Map<string, TerminalInstance>()
  private nextId = 1

  create(cols: number, rows: number): string {
    const id = `terminal-${this.nextId++}`

    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    const args = process.platform === 'win32' ? ['-NoLogo', '-ExecutionPolicy', 'Bypass'] : []

    // Inject MCP environment variables for LLM CLI auto-discovery
    const env = { ...(process.env as Record<string, string>) }
    if (mcpServerManager.isRunning) {
      env.COMFYUI_MCP_URL = mcpServerManager.url
      env.MCP_ENDPOINT = mcpServerManager.url
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: resolveTerminalWorkingDirectory(),
      env
    })

    ptyProcess.onData((data: string) => {
      this.sendToRenderer(IPC_CHANNELS.TERMINAL_DATA, { id, data })
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.sendToRenderer(IPC_CHANNELS.TERMINAL_EXIT, { id, exitCode })
      this.terminals.delete(id)
    })

    this.terminals.set(id, { pty: ptyProcess, id })
    return id
  }

  write(id: string, data: string): void {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.pty.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.pty.resize(cols, rows)
    }
  }

  destroy(id: string): void {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.pty.kill()
      this.terminals.delete(id)
    }
  }

  destroyAll(): void {
    for (const [id] of this.terminals) {
      this.destroy(id)
    }
  }

  getActiveIds(): string[] {
    return Array.from(this.terminals.keys())
  }

  private sendToRenderer(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }
}

export function resolveTerminalWorkingDirectory(
  env: NodeJS.ProcessEnv = process.env,
  defaultHome = homedir()
): string {
  return env.HOME || env.USERPROFILE || defaultHome
}

export const ptyManager = new PtyManager()
