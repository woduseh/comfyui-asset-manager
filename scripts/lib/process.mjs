/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, fstatSync, openSync, readSync } from 'node:fs'

// Capture stdout/stderr directly to a file. No shell, anonymous pipes, or security flags.
export function runLoggedProcess(
  executable,
  args,
  { cwd, logPath, timeoutMs, signal, env, append = false, output }
) {
  return new Promise((resolveResult) => {
    const descriptor = openSync(logPath, append ? 'a' : 'w')
    let reader = output ? openSync(logPath, 'r') : undefined
    let offset = fstatSync(descriptor).size
    const buffer = Buffer.alloc(64 * 1024)
    const relay = () => {
      if (reader === undefined) return
      let size
      while (
        reader !== undefined &&
        (size = readSync(reader, buffer, 0, buffer.length, offset)) > 0
      ) {
        offset += size
        output.write(Buffer.from(buffer.subarray(0, size)))
      }
    }
    const logError = (error) => {
      const message = String(error.message ?? error)
      appendFileSync(logPath, `${message}\n`)
      return message
    }
    let child
    try {
      if (signal?.aborted) {
        closeSync(descriptor)
        if (reader !== undefined) closeSync(reader)
        resolveResult({ exitCode: 130, signal: 'aborted' })
        return
      }
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', descriptor, descriptor]
      })
    } catch (error) {
      closeSync(descriptor)
      const message = logError(error)
      relay()
      if (reader !== undefined) closeSync(reader)
      resolveResult({ exitCode: 1, signal: null, error: message })
      return
    }
    closeSync(descriptor)
    let settled = false
    let timedOut = false
    let spawnError
    let timer
    const poll = output ? setInterval(relay, 100) : undefined
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      signal?.removeEventListener('abort', stop)
      relay()
      if (reader !== undefined) {
        closeSync(reader)
        reader = undefined
      }
      resolveResult(result)
    }
    const stop = () => {
      if (!child.pid || child.exitCode !== null) return
      try {
        if (process.platform === 'win32') {
          const killLog = openSync(logPath, 'a')
          let result
          try {
            result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              shell: false,
              stdio: ['ignore', killLog, killLog],
              timeout: 5000
            })
          } finally {
            closeSync(killLog)
          }
          if (result.error || result.status !== 0)
            throw result.error ?? new Error(`taskkill failed (exit ${result.status})`)
        } else process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        // The owned process handle may still permit stopping the direct child. A failed
        // tree termination remains a failure even if this best-effort cleanup succeeds.
        try {
          child.kill('SIGKILL')
        } catch {
          /* Preserve the tree termination error. */
        }
        child.unref()
        finish({
          exitCode: signal?.aborted ? 130 : 1,
          signal: signal?.aborted ? 'aborted' : null,
          timedOut,
          terminationFailed: true,
          pid: child.pid,
          error: logError(error)
        })
      }
    }
    if (timeoutMs !== undefined)
      timer = setTimeout(() => {
        timedOut = true
        stop()
      }, timeoutMs)
    child.on('error', (error) => {
      spawnError = logError(error)
    })
    child.on('close', (code, exitSignal) =>
      finish({
        exitCode: signal?.aborted ? 130 : timedOut ? 1 : (code ?? 1),
        signal: exitSignal,
        timedOut,
        ...(spawnError && { error: spawnError })
      })
    )
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
  })
}
