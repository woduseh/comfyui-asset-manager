import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'

/** Wait for stdio to close too, so temporary files can be removed on Windows. */
export function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    let error: Error | undefined
    const timer = setTimeout(() => {
      error = new Error(`Child process exceeded ${timeoutMs}ms`)
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    child.once('error', (cause) => {
      error = cause
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (error) reject(new Error(`${error.message}\n${stderr}`))
      else resolve({ code, stderr })
    })
  })
}

export async function terminateChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  child.kill('SIGKILL')
  await closed
}
